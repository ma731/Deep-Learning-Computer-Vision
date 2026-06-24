"""Build the FreshGuard training set from the Kaggle 'Fruit and Vegetable
Disease (Healthy vs Rotten)' dataset.

We use a single source for all classes (consistent photography + labeling),
selecting the four COCO-detectable produce types so Stage-1 YOLO works
zero-shot: apple, banana, orange (fruit) + carrot (vegetable).

Output: data/dataset/{train,test}/<class>/  with an 85/15 split.
Class names follow the backend contract: rotten classes start with 'rotten',
and each name contains the COCO fruit/veg word (for the detector-agreement check).
"""

import argparse
import shutil
from pathlib import Path

import kagglehub

ROOT = Path(__file__).resolve().parent.parent
SEED = 42
TEST_FRAC = 0.15
N_SAMPLE = 4  # images per class copied into the repo as a visible sample

# class name (ours)  ->  source folder name
# 10 produce types x {fresh, rotten} = 20 classes. apple/banana/orange/carrot
# are COCO-detectable (Stage-1 YOLO live box + tracking); the rest are graded
# via the classifier with a center-crop fallback (no broccoli — no clean data).
MAPPING = {
    "fresh_apple":  "Apple__Healthy",
    "rotten_apple": "Apple__Rotten",
    "fresh_banana": "Banana__Healthy",
    "rotten_banana": "Banana__Rotten",
    "fresh_orange": "Orange__Healthy",
    "rotten_orange": "Orange__Rotten",
    "fresh_carrot": "Carrot__Healthy",
    "rotten_carrot": "Carrot__Rotten",
    # well-sampled additions (600-2,000 imgs each)
    "fresh_tomato": "Tomato__Healthy",
    "rotten_tomato": "Tomato__Rotten",
    "fresh_potato": "Potato__Healthy",
    "rotten_potato": "Potato__Rotten",
    "fresh_cucumber": "Cucumber__Healthy",
    "rotten_cucumber": "Cucumber__Rotten",
    "fresh_bellpepper": "Bellpepper__Healthy",
    "rotten_bellpepper": "Bellpepper__Rotten",
    "fresh_mango": "Mango__Healthy",
    "rotten_mango": "Mango__Rotten",
    "fresh_strawberry": "Strawberry__Healthy",
    "rotten_strawberry": "Strawberry__Rotten",
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "dataset",
                        help="Where to write train/test splits (default: data/dataset/)")
    args = parser.parse_args()
    out = args.output
    # Sample images go beside the dataset output so all writes land in the same place.
    # On Colab this keeps everything on the local VM and away from Drive I/O quota.
    sample = out.parent / "sample_images"

    src_root = Path(kagglehub.dataset_download(
        "muhammad0subhan/fruit-and-vegetable-disease-healthy-vs-rotten"))
    base = next(p for p in src_root.rglob("*Dataset*") if p.is_dir())
    print("source:", base)

    if out.exists():
        shutil.rmtree(out)
    if sample.exists():
        shutil.rmtree(sample)   # keep the committed sample set clean on rebuild
    summary = {}
    for cls, folder in MAPPING.items():
        imgs = sorted((base / folder).glob("*"))
        imgs = [p for p in imgs if p.suffix.lower() in (".jpg", ".jpeg", ".png")]
        # deterministic shuffle by hashing the filename with the seed
        imgs.sort(key=lambda p: hash((SEED, p.name)))
        n_test = int(len(imgs) * TEST_FRAC)
        splits = {"test": imgs[:n_test], "train": imgs[n_test:]}
        for split, files in splits.items():
            dst = out / split / cls
            dst.mkdir(parents=True, exist_ok=True)
            for p in files:
                shutil.copy2(p, dst / p.name)
        # copy a few into the repo-visible sample folder
        sdst = sample / cls
        sdst.mkdir(parents=True, exist_ok=True)
        for p in splits["train"][:N_SAMPLE]:
            shutil.copy2(p, sdst / p.name)
        summary[cls] = {"train": len(splits["train"]), "test": len(splits["test"])}
        print(f"  {cls:15s} train {summary[cls]['train']:5d}  test {summary[cls]['test']:5d}")

    total_tr = sum(v["train"] for v in summary.values())
    total_te = sum(v["test"] for v in summary.values())
    print(f"\nTotal: {total_tr} train / {total_te} test across {len(MAPPING)} classes")
    print("Output:", out)
    print("Sample images for repo:", sample)


if __name__ == "__main__":
    main()
