export const Colors = {
  primary: '#111F84',
  secondary: '#3044DD',
  white: '#FFFFFF',
  black: '#000',
  background: '#EDEFF9',
  border: '#EDEFF9',
  gradientStart: 'rgba(255, 255, 255, 0.1)',
  gradientEnd: '#FFFFFF',
};

export const Typography = {
  fontFamily: {
    medium: 'RethinkSans-Medium',
    mono: 'SpaceMono',
  },
  fontSize: {
    h1: 24,
    body: 16,
    tabLabel: 16,
  },
  fontWeight: {
    bold: '700' as const,
    medium: '500' as const,
  },
  lineHeight: {
    h1: 31,
    body: 21,
    tabLabel: 16,
  },
  letterSpacing: {
    h1: 0.48,
    body: 0.16,
    tabLabel: -0.16,
  },
};

export const Spacing = {
  screen: {
    horizontal: 32,
    top: 72,
    bottom: 8,
    gap: 8,
    sectionGap: 24,
  },
  accordion: {
    padding: 32,
    gap: 24,
    titleGap: 16,
    contentGap: 8,
  },
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
