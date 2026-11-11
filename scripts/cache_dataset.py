"""Decode the produce dataset once into uint8 arrays (224x224 RGB) so the CNN and
the ViT are scored on exactly the same pixels.

Split matches train_models.py: Keras validation_split=0.15 takes the first 15%
of each class's sorted files as validation; test is the untouched test folder.

Run:  .venv\\Scripts\\python.exe scripts/cache_dataset.py [--out DIR]
"""
import argparse
import json
import pathlib
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "dataset"
IMG, VAL_SPLIT = 224, 0.15
EXTS = (".jpg", ".jpeg", ".png")


def list_split(classes):
    train, val, test = [], [], []
    for i, c in enumerate(classes):
        files = sorted(p for p in (DATA / "train" / c).iterdir() if p.suffix.lower() in EXTS)
        n_val = int(round(len(files) * VAL_SPLIT))
        val += [(p, i) for p in files[:n_val]]
        train += [(p, i) for p in files[n_val:]]
        tfiles = sorted(p for p in (DATA / "test" / c).iterdir() if p.suffix.lower() in EXTS)
        test += [(p, i) for p in tfiles]
    return {"train": train, "val": val, "test": test}


def load(path):
    im = cv2.imread(str(path))
    if im is None:
        return None
    return cv2.cvtColor(cv2.resize(im, (IMG, IMG)), cv2.COLOR_BGR2RGB)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(pathlib.Path.home() / "fg_cache"))
    out = pathlib.Path(ap.parse_args().out)
    out.mkdir(parents=True, exist_ok=True)
    classes = json.loads((ROOT / "models" / "class_names.json").read_text())
    for name, items in list_split(classes).items():
        x = np.lib.format.open_memmap(out / f"{name}_x.npy", mode="w+", dtype=np.uint8,
                                      shape=(len(items), IMG, IMG, 3))
        y = np.full(len(items), -1, dtype=np.int16)
        with ThreadPoolExecutor(8) as ex:
            for k, (img, (_, lab)) in enumerate(zip(ex.map(load, (p for p, _ in items)), items)):
                if img is not None:
                    x[k], y[k] = img, lab
        x.flush()
        np.save(out / f"{name}_y.npy", y)
        print(name, len(items), "unreadable:", int((y < 0).sum()), flush=True)
    (out / "classes.json").write_text(json.dumps(classes))


if __name__ == "__main__":
    main()
