Rule 11 of `_rules.md`: off acknowledges and writes nothing. The caller passes the switch state it
already read (`ctx.state`); `submit()` fails closed and writes no row.
