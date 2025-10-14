export const Colors = {
  primary: '#111F84',
  white: '#FFFFFF',
  black: '#000',
  gradientStart: 'rgba(255, 255, 255, 0.1)',
  gradientEnd: '#FFFFFF',
};

export const Typography = {
  fontFamily: {
    medium: 'RethinkSans-Medium',
    mono: 'SpaceMono',
  },
  fontSize: {
    tabLabel: 16,
  },
  fontWeight: {
    medium: '500' as const,
  },
  letterSpacing: {
    tabLabel: -0.16,
  },
};

export const Spacing = {
  tabBar: {
    containerHeight: 120,
    height: 72,
    itemHeight: 64,
    borderRadius: 64,
    itemBorderRadius: 40,
    horizontalPadding: 24,
    bottomPaddingIOS: 24,
    bottomPaddingAndroid: 16,
    innerPadding: 4,
    maxWidth: 344,
  },
  icon: {
    size: 24,
    labelGap: 2,
  },
};

export const Shadows = {
  tabBar: {
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 8,
  },
};
