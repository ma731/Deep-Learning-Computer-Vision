"""Build the FreshGuard training set from the Kaggle 'Fruit and Vegetable
Disease (Healthy vs Rotten)' dataset.

We use a single source for all classes (consistent photography + labeling),
selecting the four COCO-detectable produce types so Stage-1 YOLO works
zero-shot: apple, banana, orange (fruit) + carrot (vegetable).

Output: data/dataset/{train,test}/<class>/  with an 85/15 split.
Class names follow the backend contract: rotten classes start with 'rotten',
and each name contains the COCO fruit/veg word (for the detector-agreement check).
"""

import shutil
from pathlib import Path

import kagglehub

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "dataset"
SAMPLE = ROOT / "data" / "sample_images"
SEED = 42
TEST_FRAC = 0.15
N_SAMPLE = 4  # images per class copied into the repo as a visible sample

# class name (ours)  ->  source folder name
MAPPING = {
    "fresh_apple":  "Apple__Healthy",
    "rotten_apple": "Apple__Rotten",
    "fresh_banana": "Banana__Healthy",
    "rotten_banana": "Banana__Rotten",
    "fresh_orange": "Orange__Healthy",
    "rotten_orange": "Orange__Rotten",
    "fresh_carrot": "Carrot__Healthy",
    "rotten_carrot": "Carrot__Rotten",
}


def main():
    src_root = Path(kagglehub.dataset_download(
        "muhammad0subhan/fruit-and-vegetable-disease-healthy-vs-rotten"))
    base = next(p for p in src_root.rglob("*Dataset*") if p.is_dir())
    print("source:", base)

    if OUT.exists():
        shutil.rmtree(OUT)
    summary = {}
    for cls, folder in MAPPING.items():
        imgs = sorted((base / folder).glob("*"))
        imgs = [p for p in imgs if p.suffix.lower() in (".jpg", ".jpeg", ".png")]
        # deterministic shuffle by hashing the filename with the seed
        imgs.sort(key=lambda p: hash((SEED, p.name)))
        n_test = int(len(imgs) * TEST_FRAC)
        splits = {"test": imgs[:n_test], "train": imgs[n_test:]}
        for split, files in splits.items():
            dst = OUT / split / cls
            dst.mkdir(parents=True, exist_ok=True)
            for p in files:
                shutil.copy2(p, dst / p.name)
        # copy a few into the repo-visible sample folder
        sdst = SAMPLE / cls
        sdst.mkdir(parents=True, exist_ok=True)
        for p in splits["train"][:N_SAMPLE]:
            shutil.copy2(p, sdst / p.name)
        summary[cls] = {"train": len(splits["train"]), "test": len(splits["test"])}
        print(f"  {cls:15s} train {summary[cls]['train']:5d}  test {summary[cls]['test']:5d}")

    total_tr = sum(v["train"] for v in summary.values())
    total_te = sum(v["test"] for v in summary.values())
    print(f"\nTotal: {total_tr} train / {total_te} test across {len(MAPPING)} classes")
    print("Output:", OUT)
    print("Sample images for repo:", SAMPLE)


if __name__ == "__main__":
    main()
