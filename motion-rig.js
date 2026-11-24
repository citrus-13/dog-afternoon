// Calibrated against the original 1600 x 800 transparent cutouts.
// Coordinates/radii are normalized by image width and height. Eye angles
// are clockwise radians in image pixel axes (x right, y down).
// Profile dogs already have closed eyes, so their rigs follow the narrow lid.
// Each ear is [center x, center y, radius x, radius y, outward direction].
// Touch ellipses are [center x, center y, radius x, radius y] on visible texture.
// Side/chest targets leave the keyboard back stroke (u .452-.708, v .40) clear.
// Rana's body sits at (20, 80) on the 1920 × 960 tail composite.
const placeRana=([x,y,rx,ry,...rest])=>[
  (x*1600+20)/1920,(y*800+80)/960,rx*1600/1920,ry*800/960,...rest
];

export const dogRig = {
  sheepdog: {
    eyes: [
      [0.19875, 0.5675, 0.015, 0.02375, 0.18],
      [0.30625, 0.48125, 0.015, 0.025, 0.1],
    ].map(placeRana),
    paws: [
      [0.11375, 0.8325, 0.075, 0.09125],
      [0.28125, 0.89, 0.06875, 0.0475],
    ].map(placeRana),
    ear: placeRana([.115,.609,.055,.131,-1]),
    touch: {
      nose: placeRana([.313,.757,.032,.047]),
      chest: placeRana([.448,.692,.062,.095]),
      side: placeRana([.635,.570,.092,.112]),
      tail: [.894,.444,.108,.109],
    },
  },
  cockapoo: {
    eyes: [
      [0.190625, 0.59625, 0.0175, 0.025, 0.05],
      [0.295, 0.5275, 0.015, 0.02875, -0.18],
    ],
    paws: [
      [0.13875, 0.80875, 0.046875, 0.055],
      [0.284375, 0.84375, 0.068125, 0.03625],
    ],
    ear: [.105,.617,.051,.141,-1],
    touch: {
      nose: [.274,.715,.028,.045],
      chest: [.445,.640,.047,.090],
      side: [.611,.560,.105,.110],
      tail: [.895,.609,.064,.128],
    },
  },
  golden: {
    eyes: [[0.1675, 0.5625, 0.01875, 0.00875, 0.36]],
    paws: [
      [0.11, 0.47625, 0.031875, 0.03625],
      [0.1575, 0.68875, 0.053125, 0.0425],
    ],
    ear: [.279,.523,.059,.112,1],
    touch: {
      nose: [.088,.596,.019,.028],
      chest: [.370,.598,.060,.085],
      side: [.568,.561,.108,.105],
      tail: [.853,.697,.046,.115],
    },
  },
  shiba: {
    eyes: [[0.133125, 0.6, 0.018125, 0.00875, 0.24]],
    paws: [
      [0.110625, 0.75875, 0.038125, 0.0325],
      [0.17125, 0.7825, 0.04875, 0.035],
    ],
    ear: [.218,.463,.041,.081,1],
    touch: {
      nose: [.045,.678,.021,.031],
      chest: [.326,.653,.065,.076],
      side: [.580,.576,.105,.110],
      tail: [.903,.631,.055,.148],
    },
  },
  samoyed: {
    eyes: [[0.12875, 0.635, 0.015625, 0.0075, 0.24]],
    paws: [[0.109375, 0.7825, 0.051875, 0.0375]],
    ear: [.225,.552,.044,.101,1],
    touch: {
      nose: [.052,.697,.018,.024],
      chest: [.326,.658,.059,.094],
      side: [.551,.568,.106,.109],
      tail: [.832,.701,.078,.150],
    },
  },
  bichon: {
    eyes: [[.227,.515,.017,.020,.05],[.310,.476,.015,.019,-.09]],
    paws: [[.123,.763,.047,.051],[.226,.787,.062,.042]],
    ear: [.153,.574,.047,.122,-1],
    touch: {
      nose: [.282,.608,.023,.035],
      chest: [.427,.655,.048,.075],
      side: [.613,.613,.099,.100],
      tail: [.856,.639,.043,.080],
    },
  },
};
