/**
 * SVG-definition för gödselspridare
 * Stiliserad centrifugalspridare sedd bakifrån
 */

const SPREADER_CONFIG = {
  width: 100,
  height: 120,
  colors: {
    body: '#4a5568',      // Mörkgrå kropp
    hopper: '#718096',    // Ljusare behållare
    disk: '#ecc94b',      // Gul tallrik
    accent: '#f6ad55'     // Orange accent
  }
};

/**
 * Returnerar path data för spridaren som kan ritas på canvas
 */
function getSpreaderPaths() {
  return {
    // Behållare/tratt (trapezoid)
    hopper: {
      type: 'polygon',
      points: [
        [30, 20], [70, 20],  // Topp
        [60, 60], [40, 60]   // Botten
      ],
      fill: SPREADER_CONFIG.colors.hopper
    },
    
    // Nedre kropp/fäste
    body: {
      type: 'rect',
      x: 35,
      y: 60,
      width: 30,
      height: 15,
      fill: SPREADER_CONFIG.colors.body
    },
    
    // Spridartallrik (cirkel med armar)
    disk: {
      type: 'circle',
      cx: 50,
      cy: 85,
      radius: 20,
      fill: SPREADER_CONFIG.colors.disk,
      opacity: 0.9
    },
    
    // Tallriksarmar (4 radiella linjer som roterar)
    arms: [
      { x1: 50, y1: 85, x2: 68, y2: 85 },  // Höger
      { x1: 50, y1: 85, x2: 32, y2: 85 },  // Vänster
      { x1: 50, y1: 85, x2: 50, y2: 67 },  // Upp
      { x1: 50, y1: 85, x2: 50, y2: 103 }  // Ner
    ],
    
    // Emission points (där partiklar ska komma från)
    emissionPoints: {
      left: { x: 32, y: 85 },   // Vänster kant av tallrik
      right: { x: 68, y: 85 }   // Höger kant av tallrik
    }
  };
}

// Exportera för användning i spreader-loader.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getSpreaderPaths, SPREADER_CONFIG };
}
