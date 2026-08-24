# Glassware

One JSON file per glass: name, capacity in millilitres, shape family, and the
modelled ice displacement for each ice style it is served with.

The capacity drives a build-time fit check. The displacement figures are what
make that check meaningful — a drink served over ice needs a figure for its ice
style, or the fit cannot be checked and the build says so.
