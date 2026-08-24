import torch
from torch import nn


MODEL_SPEC = {
    "name": "ExampleUploadedModel",
    "description": "Minimal model definition for AresVision uploaded-model training.",
    "parameters": {
        "hidden_dim": {"type": "int", "default": 16, "min": 4, "max": 128},
        "dropout": {"type": "float", "default": 0.1, "min": 0.0, "max": 0.9},
    },
}

# Models that need historical solar longitude can opt in with this metadata:
# MODEL_SPEC_WITH_LS = {
#     **MODEL_SPEC,
#     "auxiliary_inputs": {
#         "ls": {
#             "required": True,
#             "shape": ["batch", "window"],
#             "dtype": "float32",
#             "unit": "degree",
#         }
#     },
# }
# The corresponding model method is:
# def forward(self, x, ls):
#     ...


class ExampleUploadedModel(nn.Module):
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
        # x shape: [batch, window, channels, height, width]
        last_frame = x[:, -1]
        prediction = self.encoder(last_frame)
        return prediction.unsqueeze(1).repeat(1, self.horizon, 1, 1, 1)


def build_model(config):
    return ExampleUploadedModel(
        in_channels=config["in_channels"],
        horizon=config["horizon"],
        hidden_dim=config["hidden_dim"],
        dropout=config["dropout"],
    )
