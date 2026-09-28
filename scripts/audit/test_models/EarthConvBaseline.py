"""Reference Earth-compatible uploaded model for smoke tests and documentation.

Shows the smallest useful Earth model: it declares the ``earth_merra2`` feed, takes
the platform's ``[batch, 7, C, 36, 72]`` input and returns ``[batch, 3, 1, 36, 72]``.
"""

import torch
from torch import nn


MODEL_SPEC = {
    "name": "EarthConvBaseline",
    "description": "Conv2d encoder over the last Earth frame with a 3-day head.",
    "parameters": {
        "hidden_dim": {"type": "int", "default": 16, "min": 4, "max": 64},
        "dropout": {"type": "float", "default": 0.1, "min": 0.0, "max": 0.5},
    },
    # Opting in to the Earth feed is explicit; without this block the model is
    # treated as Mars-only and the platform refuses Earth training.
    "datasets": {
        "earth_merra2": {
            "grid": [[36, 72]],
            "window": [7],
            "horizon": [3],
            "auxiliary_inputs": [],
            "target_leading_channels": 1,
        }
    },
}


class EarthConvBaseline(nn.Module):
    def __init__(self, in_channels, horizon, hidden_dim, dropout):
        super().__init__()
        self.horizon = horizon
        self.encoder = nn.Sequential(
            nn.Conv2d(in_channels, hidden_dim, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.Dropout2d(dropout),
            nn.Conv2d(hidden_dim, 1, kernel_size=1),
        )

    def forward(self, x):
        # x: [batch, window, channels, height, width]
        last_frame = x[:, -1]
        prediction = self.encoder(last_frame)
        return prediction.unsqueeze(1).repeat(1, self.horizon, 1, 1, 1)


def build_model(config):
    return EarthConvBaseline(
        in_channels=config["in_channels"],
        horizon=config["horizon"],
        hidden_dim=config["hidden_dim"],
        dropout=config["dropout"],
    )
