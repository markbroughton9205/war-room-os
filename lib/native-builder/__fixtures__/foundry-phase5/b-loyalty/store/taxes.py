def add_vat(amount, rate=0.21):
    return round(amount * (1 + rate), 2)
