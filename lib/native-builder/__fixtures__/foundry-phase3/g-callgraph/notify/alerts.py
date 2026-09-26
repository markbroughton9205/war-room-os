from notify.dispatch import send_notice


def raise_alert(user, level):
    return send_notice(user, "alert " + level)
