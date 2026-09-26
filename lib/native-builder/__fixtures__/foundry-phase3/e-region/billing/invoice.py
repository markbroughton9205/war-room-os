from billing.tax import add_tax


def invoice_total(lines, region="US"):
    net = sum(line["price"] * line["qty"] for line in lines)
    return add_tax(net, region)
