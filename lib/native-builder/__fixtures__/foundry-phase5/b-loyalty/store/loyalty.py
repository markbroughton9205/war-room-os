TIERS = [("gold", 1000), ("silver", 500), ("bronze", 100)]


def tier_for(customer):
    """The loyalty tier a customer has earned from their points."""
    points = customer.get("points", 0)
    for name, minimum in TIERS:
        if points > minimum:
            return name
    return None
