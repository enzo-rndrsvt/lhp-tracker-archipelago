class OptionError(Exception):
    pass


class Option:
    default = 0


class Toggle(Option):
    default = 0


class DefaultOnToggle(Toggle):
    default = 1


class Range(Option):
    pass


class Choice(Option):
    pass


class OptionList(Option):
    default = []


class PerGameCommonOptions:
    pass
