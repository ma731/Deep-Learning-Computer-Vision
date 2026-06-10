"""Grad-CAM explainability for the FreshGuard classifier.

The training notebook builds the final model UN-nested (head layers applied
directly on the MobileNetV2 graph), so the last conv layer ('out_relu') is
reachable directly from the full model. That keeps Grad-CAM a 15-liner.
"""

import cv2
import numpy as np
import tensorflow as tf

LAST_CONV_LAYER = "out_relu"  # last conv activation in MobileNetV2


def _find_last_conv(model: tf.keras.Model) -> str:
    """Fall back to searching for the last 4D-output layer if the model
    wasn't built with the expected MobileNetV2 backbone."""
    try:
        model.get_layer(LAST_CONV_LAYER)
        return LAST_CONV_LAYER
    except ValueError:
        for layer in reversed(model.layers):
            shape = getattr(layer, "output_shape", None)
            if shape is not None and len(shape) == 4:
                return layer.name
    raise ValueError("No conv layer found for Grad-CAM")


def gradcam_heatmap(model: tf.keras.Model, img_batch: np.ndarray,
                    class_index: int | None = None) -> np.ndarray:
    """Return a (h, w) heatmap in [0, 1] for one preprocessed image batch."""
    layer_name = _find_last_conv(model)
    grad_model = tf.keras.Model(
        model.input, [model.get_layer(layer_name).output, model.output]
    )
    with tf.GradientTape() as tape:
        conv_out, predictions = grad_model(img_batch)
        if class_index is None:
            class_index = int(tf.argmax(predictions[0]))
        class_channel = predictions[:, class_index]

    grads = tape.gradient(class_channel, conv_out)
    pooled_grads = tf.reduce_mean(grads, axis=(0, 1, 2))
    heatmap = conv_out[0] @ pooled_grads[..., tf.newaxis]
    heatmap = tf.squeeze(heatmap)
    heatmap = tf.maximum(heatmap, 0) / (tf.reduce_max(heatmap) + 1e-8)
    return heatmap.numpy()


def overlay_heatmap(crop_bgr: np.ndarray, heatmap: np.ndarray,
                    alpha: float = 0.45) -> np.ndarray:
    """Blend the heatmap over the original (BGR) crop and return BGR image."""
    h, w = crop_bgr.shape[:2]
    heat = cv2.resize((heatmap * 255).astype(np.uint8), (w, h))
    heat_color = cv2.applyColorMap(heat, cv2.COLORMAP_JET)
    return cv2.addWeighted(heat_color, alpha, crop_bgr, 1 - alpha, 0)
