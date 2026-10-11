from typing import Literal

Operator = Literal["eq", "ne", "gt", "lt", "ge", "le", "contains"]


class OptionFilter:
    def __init__(self, option, value, operator="eq"):
        self.option, self.value, self.operator = option, value, operator

    def to_json(self):
        return {"o": self.option.__name__, "v": self.value, "op": self.operator}
