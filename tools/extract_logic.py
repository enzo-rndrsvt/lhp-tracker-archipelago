"""
Extract the Lego Harry Potter 5-7 logic from its .apworld into a JSON file the web tracker can evaluate.

The apworld is imported against lightweight stubs of the Archipelago framework (tools/stubs). Every
region connection, location and `set_rule` call is captured and serialized as a rule tree.

Usage:
    python tools/extract_logic.py [path/to/lhp2.apworld] [output.json]
"""
import json
import os
import shutil
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_APWORLD = r"C:\ProgramData\Archipelago\custom_worlds\lhp2.apworld"
DEFAULT_OUT = os.path.join(HERE, "..", "src", "data", "logic.json")


# Rules.py helper -> name shown in the tracker. Helpers that are just "X + Polyjuice" stay unnamed.
HELPER_LABELS = {
    "can_use_dark_mag": "Magie noire",
    "can_use_spanner": "Clé à molette",
    "can_use_key": "Clé (gobelin)",
    "char_can_dig": "Perso qui creuse",
    "can_dig_in_level": "Creuser",
    "can_dig_in_hub": "Creuser (hub)",
    "strong_chars": "Perso costaud",
    "char_is_strong_level": "Force",
    "char_is_strong_hub": "Force (hub)",
    "ravenclaw_chars": "Perso Serdaigle",
    "has_low_multi": "Multiplicateur de score",
    "has_high_multi": "Gros multiplicateur (x6+ ou x2+x4)",
}


class Opt(int):
    """Option value usable both as an int and through `.value`."""

    @property
    def value(self):
        return int(self)


class ListOpt:
    def __init__(self, value):
        self.value = value


class Placeholder:
    """Option whose value is only known at runtime (from slot_data). Serialized as "$Name"."""

    def __init__(self, name):
        self.value = "$" + name


def make_options(end_goal):
    class O:
        pass

    o = O()
    o.EndGoal = Opt(end_goal)
    # Values chosen so every conditional rule block gets registered; the tracker
    # filters locations by what the server actually reports.
    o.ShuffleCharacterTokens = Opt(0)
    o.ShuffleRedBricks = Opt(0)
    o.ShuffleJokeSpells = Opt(1)
    o.ShuffleGoldBrickPurchases = Opt(1)
    o.HardPurchases = Opt(0)
    o.DisabledLevels = ListOpt([])
    o.NumHorcruxRequired = Placeholder("NumHorcruxRequired")
    o.NumLevelsRequired = Placeholder("NumLevelsRequired")
    return o


class FakeMultiWorld:
    def __init__(self):
        self.regions = []
        self.entrances = []

    def get_region(self, name, player):
        for r in self.regions:
            if r.name == name:
                return r
        raise KeyError(name)


class RuleWorld:
    def __init__(self, options):
        self.options = options
        self.location_rules = {}
        self.entrance_rules = {}
        self.completion = None

    def get_location(self, name):
        return ("loc", name)

    def get_entrance(self, name):
        return ("ent", name)

    def set_rule(self, target, rule):
        kind, name = target
        (self.location_rules if kind == "loc" else self.entrance_rules)[name] = rule.to_json()

    def set_completion_rule(self, rule):
        self.completion = rule.to_json()




def main():
    apworld = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_APWORLD
    out_path = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT

    tmp = tempfile.mkdtemp(prefix="lhp2_extract_")
    try:
        shutil.copytree(os.path.join(HERE, "stubs"), os.path.join(tmp, "stubs"))
        with zipfile.ZipFile(apworld) as z:
            z.extractall(os.path.join(tmp, "stubs", "worlds"))
        sys.path.insert(0, os.path.join(tmp, "stubs"))

        from worlds.lhp2 import Rules, Regions, Locations, Items  # noqa: E402

        def multi_json(self):
            data = Locations.all_location_table[self.location_name]
            return {"t": "multi", "p": data.price}

        Rules.HasMultiplier._json = multi_json

        # Name the shared helper rules so requirements read like the logic sheet.
        for attr, label in HELPER_LABELS.items():
            getattr(Rules, attr).label = label

        variants = {}
        base = None
        for end_goal in (0, 2):
            options = make_options(end_goal)
            mw = FakeMultiWorld()
            Regions.create_regions(mw, options, 1, Locations.all_location_table)
            rw = RuleWorld(options)
            Rules.set_rules(rw)

            events = {}
            locations = {}
            for region in mw.regions:
                for loc in region.locations:
                    if loc.address is None:
                        events[loc.name] = {
                            "region": region.name,
                            "item": loc.item.name,
                            "rule": rw.location_rules.get(loc.name, {"t": "true"}),
                        }
                    else:
                        locations[loc.name] = {
                            "id": loc.address,
                            "region": region.name,
                            "rule": rw.location_rules.get(loc.name, {"t": "true"}),
                        }

            entrances = [
                {"from": a, "to": b, "rule": rw.entrance_rules.get(f"{a} -> {b}", {"t": "true"})}
                for a, b in mw.entrances
            ]
            if base is None:
                base = {"regions": [r.name for r in mw.regions], "entrances": entrances, "locations": locations}
            variants[str(end_goal)] = {"events": events, "completion": rw.completion}

        result = {
            "game": "Lego Harry Potter 5-7",
            **base,
            "goals": variants,
            "horcruxes": sorted(Items.horcrux_names_set),
            "levelBeaten": sorted(Locations.level_beaten_loc_table.keys()),
            # Score multiplier rules used by shop purchases (see Rules.HasMultiplier)
            "multi": {"low": Rules.has_low_multi.to_json(), "high": Rules.has_high_multi.to_json()},
            "items": {name: d.code for name, d in Items.item_data_table.items() if d.code is not None},
        }


        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
        print(f"Wrote {out_path}: {len(base['locations'])} locations, {len(base['entrances'])} entrances")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
