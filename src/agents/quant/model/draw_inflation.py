"""Draw inflation — corrects Bivariate Poisson's under-prediction of international draws."""
from __future__ import annotations

import numpy as np
import numpy.typing as npt


def apply_draw_inflation(
    joint_dist: npt.NDArray[np.float64], inflation_factor: float = 1.18
) -> npt.NDArray[np.float64]:
    """
    International draw rate is ~28-30%; pure Bivariate Poisson predicts ~24%.
    Multiply diagonal probabilities by the inflation factor, then renormalize.
    """
    if inflation_factor <= 0:
        raise ValueError(f"Invalid inflation factor: {inflation_factor}")
    inflated = joint_dist.copy()
    n = min(inflated.shape)
    inflated[np.arange(n), np.arange(n)] *= inflation_factor
    total = inflated.sum()
    if total <= 0:
        raise ValueError("Joint distribution sums to zero")
    result: npt.NDArray[np.float64] = inflated / total
    return result
