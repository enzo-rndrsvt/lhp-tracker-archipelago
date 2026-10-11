from enum import IntFlag


class ItemClassification(IntFlag):
    filler = 0
    progression = 1
    useful = 2
    trap = 4
    skip_balancing = 8
    deprioritized = 16
    progression_skip_balancing = 9
    progression_deprioritized = 17
    progression_deprioritized_skip_balancing = 25


class Item:
    game = ""

    def __init__(self, name, classification, code, player):
        self.name, self.classification, self.code, self.player = name, classification, code, player


class Location:
    game = ""

    def __init__(self, player, name, address=None, parent=None):
        self.player, self.name, self.address, self.parent_region = player, name, address, parent
        self.item = None
        self.show_in_spoiler = False

    def place_locked_item(self, item):
        self.item = item


class Region:
    def __init__(self, name, player, multiworld):
        self.name, self.player, self.multiworld = name, player, multiworld
        self.locations = []

    def connect(self, target):
        self.multiworld.entrances.append((self.name, target.name))


class MultiWorld:
    pass


class Entrance:
    pass


class CollectionState:
    pass


class Tutorial:
    def __init__(self, *args, **kwargs):
        pass
