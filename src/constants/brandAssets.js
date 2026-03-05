const LIGHT_THEME_ASSETS = {
  logo: require("../../assets/icons/VentLogo-Light.png"),
  menu: {
    communities: require("../../assets/icons/Communities-Light.png"),
    friends: require("../../assets/icons/Friends-Light.png"),
    account: require("../../assets/icons/Account-Light.png"),
    layers: require("../../assets/icons/Layers-Light.png"),
    add: require("../../assets/icons/Add-Light.png"),
  },
};

const DARK_THEME_ASSETS = {
  logo: require("../../assets/icons/VentLogo-Dark.png"),
  menu: {
    communities: require("../../assets/icons/Communities-Dark.png"),
    friends: require("../../assets/icons/Friends-Dark.png"),
    account: require("../../assets/icons/Account-Dark.png"),
    layers: require("../../assets/icons/Layer-Dark.png"),
    add: require("../../assets/icons/Add-Dark.png"),
  },
};

export const getBrandAssetsForTheme = (isDark) =>
  isDark ? DARK_THEME_ASSETS : LIGHT_THEME_ASSETS;
