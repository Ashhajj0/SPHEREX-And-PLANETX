#!/usr/bin/env python3
"""
backend/compute/common.py
=========================
Shared utility definitions and constants for the SPHEREx compute engine.

This module is strictly foundational: it must NEVER import from any other
backend.compute module to prevent circular import dependencies.
"""

import math
from typing import Any, Optional


# ==============================================================================
# SPHEREx Flag Mask Definition
# ==============================================================================
# Verified SPHEREx Level 2 Bad Pixel Bits:
# Bit 0 (1): TRANSIENT - Cosmic ray hit or sudden detector transient
# Bit 1 (2): OVERFLOW - Saturated pixel / full-well overflow
# Bit 2 (4): SUR_ERROR - Sample-up-the-ramp readout error
# Bit 3 (8): DEAD_HOT - Calibrated unresponsive or high-dark-current pixel
# Bit 15 (32768): NONLINEAR - Severe uncorrectable non-linearity
# Bit 26 (67108864): BLOOM - Charge blooming artifact from adjacent saturated star
# Bit 27 (134217728): SNOWBALL - Large secondary cosmic-ray snowball artifact
BAD_PIXEL_MASK = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 15) | (1 << 26) | (1 << 27)

# Decoded list of bad bits actually used in BAD_PIXEL_MASK
BAD_FLAG_BITS = [bit for bit in range(32) if (BAD_PIXEL_MASK & (1 << bit)) != 0]


def is_bad_pixel(flags_array: Any) -> Any:
    """Returns a boolean array where True indicates an unusable/corrupted pixel."""
    return (flags_array & BAD_PIXEL_MASK) != 0


def sanitize_scalar(val: Any, decimals: Optional[int] = None) -> Any:
    """Helper converting NaN, Infinity, and numpy scalars to JSON-safe Python types."""
    if val is None:
        return None
    if hasattr(val, "item"):
        val = val.item()
    if isinstance(val, float):
        if math.isnan(val) or math.isinf(val):
            return None
        return round(val, decimals) if decimals is not None else val
    return val
