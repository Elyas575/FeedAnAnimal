/*
 * GENERATED FILE - do not edit by hand.
 * Source of truth: data/animals.json
 * Regenerate with: node tools/build-data.js
 *
 * Browsers refuse fetch() on file:// URLs, so index.js falls back to this
 * embedded copy when index.html is opened straight from disk.
 */
window.FEED_THE_ANIMALS_DATA = {
  "meta": {
    "version": 1,
    "app": "FeedAnAnimalMap",
    "city": "Seattle, WA",
    "region": "Oakwood Park & West End",
    "center": {
      "lat": 47.671236,
      "lng": -122.343184
    },
    "defaultZoom": 15,
    "maxZoom": 20,
    "volunteersActive": 14,
    "generatedAt": "2026-09-28T10:05:00-07:00",
    "timeModel": "relative",
    "timeModelNote": "Every *MinutesAgo / *DaysAgo field is an offset from the moment the app loads, so this snapshot never goes stale. The app converts them to absolute ISO timestamps in memory and stores volunteer actions as absolute ISO timestamps.",
    "needsHelpRule": "needsHelp = food or water is past the species \"okHours\" threshold, or health is \"treatment\" or \"critical\".",
    "urgencyPolicy": {
      "cat": {
        "food": {
          "okHours": 8,
          "urgentHours": 14
        },
        "water": {
          "okHours": 6,
          "urgentHours": 10
        }
      },
      "dog": {
        "food": {
          "okHours": 10,
          "urgentHours": 16
        },
        "water": {
          "okHours": 8,
          "urgentHours": 12
        }
      },
      "rabbit": {
        "food": {
          "okHours": 8,
          "urgentHours": 14
        },
        "water": {
          "okHours": 6,
          "urgentHours": 10
        }
      },
      "bird": {
        "food": {
          "okHours": 6,
          "urgentHours": 12
        },
        "water": {
          "okHours": 4,
          "urgentHours": 8
        }
      },
      "guinea-pig": {
        "food": {
          "okHours": 5,
          "urgentHours": 10
        },
        "water": {
          "okHours": 4,
          "urgentHours": 8
        }
      },
      "default": {
        "food": {
          "okHours": 8,
          "urgentHours": 14
        },
        "water": {
          "okHours": 6,
          "urgentHours": 10
        }
      }
    },
    "activityKinds": [
      "feed",
      "water",
      "report",
      "rescue",
      "medicine",
      "station"
    ],
    "speciesCatalog": [
      {
        "id": "cat",
        "label": "Cats",
        "singular": "Cat",
        "emoji": "🐱"
      },
      {
        "id": "dog",
        "label": "Dogs",
        "singular": "Dog",
        "emoji": "🐶"
      },
      {
        "id": "rabbit",
        "label": "Rabbits",
        "singular": "Rabbit",
        "emoji": "🐰"
      },
      {
        "id": "bird",
        "label": "Birds",
        "singular": "Bird",
        "emoji": "🐦"
      },
      {
        "id": "guinea-pig",
        "label": "Guinea pigs",
        "singular": "Guinea pig",
        "emoji": "🐹"
      }
    ],
    "tileLayers": [
      {
        "id": "google-streets",
        "label": "Google Streets",
        "url": "https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
        "attribution": "Map data &copy; Google",
        "subdomains": "mt0,mt1,mt2,mt3",
        "maxZoom": 20
      },
      {
        "id": "google-satellite",
        "label": "Google Satellite",
        "url": "https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}",
        "attribution": "Imagery &copy; Google, Maxar, Earthstar Geographics",
        "subdomains": "mt0,mt1,mt2,mt3",
        "maxZoom": 20
      }
    ]
  },
  "stations": [],
  "animals": [],
  "activity": []
};
