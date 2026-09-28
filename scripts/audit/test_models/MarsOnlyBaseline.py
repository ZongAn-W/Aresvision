"""A Mars-only uploaded model: valid for Mars, explicitly NOT usable on Earth.

This fixture exists so the acceptance script can prove the platform does not treat
"validated for Mars" as "usable on Earth". It declares no ``datasets`` block, which
is exactly the default for every legacy upload.
"""

import torch
from torch import nn


MODEL_SPEC = {
    "name": "MarsOnlyBaseline",
    "description": "Minimal Mars baseline; declares no Earth feed on purpose.",
    "parameters": {},
}


class MarsOnlyBaseline(nn.Module):
    def __init__(self, horizon):
        super().__init__()
        self.horizon = horizon
        # 8x16 is the Mars validation grid used by the upload dry-run.
        self.conv = nn.Conv2d(1, 1, kernel_size=1)

    def forward(self, x):
        last_frame = x[:, -1]
        prediction = self.conv(last_frame[:, :1])
        return prediction.unsqueeze(1).repeat(1, self.horizon, 1, 1, 1)


def build_model(config):
    return MarsOnlyBaseline(horizon=config["horizon"])
