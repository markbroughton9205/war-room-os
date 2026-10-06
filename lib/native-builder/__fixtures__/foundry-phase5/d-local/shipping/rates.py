def fee(weight_kg):
    """The shipping fee in whole euros."""
    return round(2.5 + 1.2 * weight_kg)
