"""Minimal stand-in for Archipelago's rule_builder that serializes rules to JSON trees."""


class Rule:
    def __init_subclass__(cls, game=None, **kwargs):
        super().__init_subclass__(**kwargs)

    def __or__(self, other):
        return Or(self, other)

    def __and__(self, other):
        return And(self, other)

    #: Display name of a reusable helper rule (e.g. "Dark Magic"), set by the extractor.
    label = None

    def to_json(self):
        j = self._json()
        if self.label:
            # Kept as one named node so the tracker can show "Dark Magic" instead of 20 characters.
            return {"t": "group", "g": self.label, "r": j}
        return j

    def _json(self):
        raise NotImplementedError(type(self).__name__)


class True_(Rule):
    def __init__(self, options=None):
        self.options = options or []

    def _json(self):
        if self.options:
            return {"t": "opt", "f": [o.to_json() for o in self.options]}
        return {"t": "true"}


class Has(Rule):
    def __init__(self, item, count=1):
        self.item, self.count = item, count

    def _json(self):
        return {"t": "has", "i": self.item, "c": self.count}


class HasAll(Rule):
    def __init__(self, *items):
        self.items = items

    def _json(self):
        return {"t": "and", "r": [{"t": "has", "i": i, "c": 1} for i in self.items]}


class _Compound(Rule):
    kind = ""

    def __init__(self, *rules):
        self.rules = rules

    def _json(self):
        out = []
        for r in self.rules:
            j = r.to_json()
            # Flatten nested compounds of the same kind
            if j["t"] == self.kind:
                out.extend(j["r"])
            else:
                out.append(j)
        return {"t": self.kind, "r": out}


class And(_Compound):
    kind = "and"


class Or(_Compound):
    kind = "or"


class CanReachRegion(Rule):
    def __init__(self, region):
        self.region = region

    def _json(self):
        return {"t": "region", "n": self.region}


class CanReachLocation(Rule):
    def __init__(self, location):
        self.location = location

    def _json(self):
        return {"t": "location", "n": self.location}
