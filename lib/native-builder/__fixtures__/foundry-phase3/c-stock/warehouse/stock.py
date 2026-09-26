def reserve(levels, sku, qty):
    """Takes qty of sku out of the available stock and returns the new level."""
    levels[sku] = levels.get(sku, 0) - qty
    return levels[sku]
