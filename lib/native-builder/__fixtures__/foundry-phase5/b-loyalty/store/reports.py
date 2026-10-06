def daily_totals(orders):
    return {day: sum(values) for day, values in orders.items()}
