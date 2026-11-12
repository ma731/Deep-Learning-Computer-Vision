"""Fine-tune a small Vision Transformer (DeiT via timm) on the cached produce data.

Needs a CUDA PyTorch env with timm (kept out of requirements.txt on purpose:
the app itself runs on TensorFlow). Reads the arrays from cache_dataset.py.

Run:  python scripts/train_vit.py --arch deit_tiny_patch16_224.fb_in1k --epochs 6
"""
import argparse
import json
import pathlib
import sys
import time

import numpy as np
import timm
import torch
import torch.nn.functional as F

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from metrics import balanced_subset, score  # noqa: E402

MEAN = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)


def to_tensor(xb, dev):
    x = torch.from_numpy(np.ascontiguousarray(xb)).to(dev).permute(0, 3, 1, 2).float() / 255
    return (x - MEAN.to(dev)) / STD.to(dev)


def augment(x):
    # flips + brightness + a light random crop, roughly what the CNN got
    flip = torch.rand(x.size(0), device=x.device) < 0.5
    x = torch.where(flip.view(-1, 1, 1, 1), x.flip(3), x)
    x = x * torch.empty(x.size(0), 1, 1, 1, device=x.device).uniform_(0.7, 1.3)
    s = int(224 * np.random.uniform(0.8, 1.0))
    i, j = np.random.randint(0, 224 - s + 1, 2)
    return F.interpolate(x[:, :, i:i + s, j:j + s], size=224, mode="bilinear", align_corners=False)


@torch.no_grad()
def predict(model, x, dev, bs=128):
    model.eval()
    out = []
    for k in range(0, len(x), bs):
        with torch.autocast(dev.type, dtype=torch.float16, enabled=dev.type == "cuda"):
            out.append(model(to_tensor(x[k:k + bs], dev)).float().softmax(1).cpu().numpy())
    return np.concatenate(out)


def cpu_latency_ms(model, runs=50):
    model = model.float().cpu().eval()
    torch.set_num_threads(4)
    x = torch.randn(1, 3, 224, 224)
    with torch.no_grad():
        for _ in range(5):
            model(x)
        t = []
        for _ in range(runs):
            t0 = time.perf_counter()
            model(x)
            t.append((time.perf_counter() - t0) * 1000)
    return round(float(np.median(t)), 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--arch", default="deit_tiny_patch16_224.fb_in1k")
    ap.add_argument("--epochs", type=int, default=6)
    ap.add_argument("--bs", type=int, default=64)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--freeze", action="store_true", help="train the head only")
    ap.add_argument("--cache", default=str(pathlib.Path.home() / "fg_cache"))
    a = ap.parse_args()
    torch.manual_seed(42)
    np.random.seed(42)
    dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    cache = pathlib.Path(a.cache)
    classes = json.loads((cache / "classes.json").read_text())
    xs = {s: np.load(cache / f"{s}_x.npy", mmap_mode="r") for s in ("train", "val", "test")}
    ys = {s: np.load(cache / f"{s}_y.npy").astype(np.int64) for s in ("train", "val", "test")}
    keep = {s: np.flatnonzero(ys[s] >= 0) for s in ys}

    model = timm.create_model(a.arch, pretrained=True, num_classes=len(classes)).to(dev)
    if a.freeze:
        for n, p in model.named_parameters():
            p.requires_grad = n.startswith("head")
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=a.lr, weight_decay=0.05)
    steps = a.epochs * (len(keep["train"]) // a.bs)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=steps, pct_start=0.1)
    scaler = torch.amp.GradScaler(enabled=dev.type == "cuda")

    tag = a.arch.split(".")[0] + ("_frozen" if a.freeze else "")
    best, best_state, hist = -1.0, None, []
    t0 = time.time()
    for ep in range(a.epochs):
        model.train()
        order = np.random.permutation(keep["train"])
        losses = []
        for k in range(0, len(order) - a.bs + 1, a.bs):
            idx = np.sort(order[k:k + a.bs])  # sorted reads are faster on a memmap
            x = augment(to_tensor(xs["train"][idx], dev))
            y = torch.from_numpy(ys["train"][idx]).to(dev)
            with torch.autocast(dev.type, dtype=torch.float16, enabled=dev.type == "cuda"):
                loss = F.cross_entropy(model(x), y, label_smoothing=0.1)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            sched.step()
            losses.append(loss.item())
        vp = predict(model, xs["val"][keep["val"]], dev)
        vacc = float((vp.argmax(1) == ys["val"][keep["val"]]).mean())
        hist.append({"epoch": ep + 1, "train_loss": round(float(np.mean(losses)), 4), "val_accuracy": round(vacc, 4)})
        print(hist[-1], f"{(time.time() - t0) / 60:.1f} min", flush=True)
        if vacc > best:
            best, best_state = vacc, {k: v.detach().clone() for k, v in model.state_dict().items()}
    minutes = (time.time() - t0) / 60
    model.load_state_dict(best_state)

    # one look at the test set, with the model picked on validation
    yt = ys["test"][keep["test"]]
    probs = predict(model, xs["test"][keep["test"]], dev)
    np.save(cache / f"probs_{tag}.npy", probs)
    np.save(cache / "test_y_kept.npy", yt)
    full = score(yt, probs, classes)
    sub = balanced_subset(yt)
    out_dir = ROOT / "models"
    torch.save(model.state_dict(), cache / f"{tag}.pt")
    size_mb = round((cache / f"{tag}.pt").stat().st_size / 1e6, 1)
    result = {
        "model": a.arch, "framework": f"torch {torch.__version__} + timm {timm.__version__}",
        "trained_on": torch.cuda.get_device_name(0) if dev.type == "cuda" else "cpu",
        "frozen_backbone": a.freeze, "epochs": a.epochs, "best_val_accuracy": round(best, 4),
        "train_minutes": round(minutes, 1),
        "params": int(sum(p.numel() for p in model.parameters())),
        "size_mb_fp32": size_mb,
        "cpu_latency_ms_batch1": cpu_latency_ms(model),
        "test_full": full,
        "test_balanced_70": score(yt[sub], probs[sub], classes),
        "history": hist,
    }
    (out_dir / f"transformer_{tag}.json").write_text(json.dumps(result, indent=2))
    print(json.dumps({k: v for k, v in result.items() if k != "history"} | {"test_full": {k: full[k] for k in ("accuracy", "macro_f1", "auc_fresh_vs_rotten", "weakest")}}, indent=1))


if __name__ == "__main__":
    main()
