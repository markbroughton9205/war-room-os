STOCK = {"apple": 40, "pear": 12}


def in_stock(product):
    return STOCK.get(product, 0) > 0
