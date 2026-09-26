def apply_coupon(total, code):
    """Returns the total after any coupon code is applied."""
    if code == "SAVE10":
        return total * 0.9
    return total
