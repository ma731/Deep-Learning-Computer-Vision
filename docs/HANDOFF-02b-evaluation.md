# Handoff → BigBossBass · Notebook 02b (Evaluation & Explainability)

> Paste this whole file into Claude Code / Claude Max as context, then work
> through the checklist. Everything you need already exists in the repo — the
> model is trained, so your job is **evaluation, not training**.

## Context (what FreshGuard is)

FreshGuard is an AI produce quality-control MVP for our Deep Learning final
project. A two-stage pipeline: YOLO detects/tracks produce, then our
fine-tuned **MobileNetV2** grades each item fresh / sell-soon / reject. There's
Grad-CAM explainability, a live "money recovered" demo, and an LSTM forecast.

**8 classes:** `fresh_apple, fresh_banana, fresh_carrot, fresh_orange,
rotten_apple, rotten_banana, rotten_carrot, rotten_orange`.

## What's already DONE (don't redo this)

- Notebook 02a (Yaxin's part): the three models are trained. The ablation:
  | Model | Test acc | Params |
  |---|---|---|
  | ANN baseline | 41.2% | 14.3M |
  | CNN from scratch | 77.6% | 8.5M |
  | MobileNetV2 transfer learning | **97.1%** | 2.6M |
- Trained artifacts are committed in `models/`:
  - `freshguard_mobilenetv2.keras` — the final model
  - `class_names.json` — class order (alphabetical, matches model output)
  - `histories.json` — per-model training/val curves (acc + loss per epoch)
  - `training_summary.json` — test acc/loss/params/time per model
- Result figures already exist in `docs/figures/` (per-model curves + comparison).

## YOUR job — notebook 02b (evaluation & explainability)

Add your sections to `notebooks/02_model_training.ipynb` (there's a marked
"## 7. Evaluation & explainability (02b)" heading at the bottom). This is the
rubric's "evaluation metrics + overfitting evidence" — worth real points.

### Checklist
- [ ] **Training-curve analysis** — load `models/histories.json`; plot train vs
      val for all 3 models; write 2-3 sentences on overfitting (where val
      diverges from train) and how augmentation/dropout/early-stopping helped.
- [ ] **Confusion matrix (8×8)** on the held-out test set + `classification_report`
      (precision/recall/F1 per class). Call out which classes confuse (likely
      fresh vs rotten of the same item, or orange vs carrot on color).
- [ ] **Fresh-vs-rotten ROC + AUC** — collapse the 8 classes to binary
      (`rotten_*` = positive). Plot the ROC, report AUC, and **justify the
      decision threshold** — tie it to `SELL_SOON_BAND = (0.40, 0.65)` in
      `backend/pipeline.py` (the band that maps rot-probability → sell-soon).
- [ ] **Grad-CAM gallery** — ~6 images showing the network attending to rot
      spots. Use the helper in `backend/gradcam.py` (`gradcam_heatmap` +
      `overlay_heatmap`); the model is built un-nested so `out_relu` is reachable.
- [ ] **Domain-shift study** — run the model on Batao's real-fruit field test
      set (`data/field_test/<class>/`, from issue #3). Report the accuracy drop
      vs the clean test set. **This is a highlight slide** — honest
      generalization analysis, not a failure. Note CLAHE/augmentation as
      mitigations.
- [ ] **Severity sanity check** — compare `rot_area_fraction` (HSV mask in
      `backend/pipeline.py`) against Grad-CAM activation area on a few crops;
      one comparison figure.
- [ ] Deck slides for your sections by the team deadline (metrics, overfitting
      evidence, Grad-CAM, domain-shift finding).

## How to run (environment)

```bash
# from repo root
python scripts/build_dataset.py    # rebuilds data/dataset/{train,test}/ (gitignored, ~15k imgs)
pip install tensorflow opencv-python scikit-learn matplotlib pandas
```

Then in the notebook:
```python
import json, tensorflow as tf
model = tf.keras.models.load_model("models/freshguard_mobilenetv2.keras")
class_names = json.load(open("models/class_names.json"))
# test generator: ImageDataGenerator(preprocessing_function=mobilenet_v2.preprocess_input)
#   .flow_from_directory("data/dataset/test", target_size=(224,224), shuffle=False)
```
⚠️ Use `mobilenet_v2.preprocess_input` (NOT 1/255) for this model, and
`shuffle=False` on the test generator so predictions line up with labels.

**GPU:** run on Colab (Runtime → T4) for speed; evaluation itself is light.

## Integration contract (don't break these)
- Don't rename `models/freshguard_mobilenetv2.keras` or `class_names.json` —
  the backend loads them by name.
- Class names: `rotten_*` must stay the prefix; the backend sums rotten-class
  probabilities by `startswith("rotten")`.

## Workflow
Branch from `main` after PR #8 merges → `feat/eval-02b` → one PR → @ma731 reviews.
Questions: ping Marco (coordinator). See issue #2 for the original spec.
