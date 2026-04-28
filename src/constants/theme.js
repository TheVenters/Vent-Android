// File purpose: Shared color palette and layout tokens used across app screens.

export const COLORS = {
  primary: '#667eea',
  secondary: '#764ba2',
  success: '#34a853',
  warning: '#fbbc04',
  danger: '#ea4335',
  dark: '#333',
  light: '#f8f9fa',
  white: '#ffffff',
  gray: '#888',
  lightGray: '#ddd',
  border: '#e0e0e0',
};

export const SIZES = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  radius: 8,
  radiusLg: 12,
  radiusXl: 16,
  radiusFull: 9999,
};

export const FONTS = {
  regular: 'System',
  medium: 'System',
  bold: 'System',
  sizes: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  },
};

export const MAP_STYLES = {
  standard: 'standard',
  satellite: 'satellite',
  hybrid: 'hybrid',
  terrain: 'terrain',
};

export const PIN_TYPES = {
  TEXT: 'text',
  PHOTO: 'photo',
  VIDEO: 'video',
  MEDIA: 'media',
};

export const LAYERS = {
  PUBLIC: 'public',
  FRIENDS: 'friends',
  PRIVATE: 'private',
  EVENTS: 'events',
};

export const GEOMETRY_TYPES = {
  POINT: 'point',
  LINE: 'line',
  PLANE: 'plane',
};

export const ACTION_BUTTON = {
  SIZE: 56,
  MARGIN: 16,
  GAP: 12,
};

export const A_BUTTON_STATE = {
  COLLAPSED: 0,
  SEARCH: 1,
  MENU: 2,
};

export const DEFAULT_REGION = {
  latitude: 39.7392,
  longitude: -104.9903,
  latitudeDelta: 0.0922,
  longitudeDelta: 0.0421,
};
