/*
 * CreativeConnect — STATIC FALLBACK CONFIG.
 *
 * When the Node server is running, this file is IGNORED: the server generates
 * /assets/js/config.js live from the SQLite database (edit content in the
 * admin dashboard at /admin). This copy only matters if you open the pages
 * as plain files without the server — it keeps them from breaking.
 */
window.CC_CONFIG = {
  ga4MeasurementId: "G-5SC0HPEY5J",
  hubspot: { portalId: "", formId: "" },

  instagramHandle: "mvcreativeconnect",
  whatsapp: "9607428224",
  email: "mvcreativeconnect@gmail.com",

  hero: {
    eyebrow: "Book your shoot in 60 seconds",
    title: "Your story, beautifully shot.",
    subtitle: "Photo and video for weddings, events and brands across the Maldives."
  },
  trust: [
    "Written quote before you book",
    "Photo + video in one team",
    "Island-wide travel"
  ],

  packages: [
    { id: "essentials", name: "Essentials", price: "MVR 2,500", popular: false, image: "package-essentials",
      includes: ["Up to 2 hours at one location", "30 edited photos", "Private online gallery", "Target delivery: 5 business days"] },
    { id: "story", name: "Story", price: "MVR 5,500", popular: true, image: "package-story",
      includes: ["Up to 4 hours of photo and video", "80 edited photos", "One 60-second highlight reel", "Private online gallery", "Target delivery: 7 business days"] },
    { id: "brand", name: "Brand", price: "MVR 9,500", popular: false, image: "package-brand",
      includes: ["Up to 8 hours of photo and video", "120 edited photos", "Three short vertical social reels", "Use on your own website and organic social", "Target delivery: 10 business days"] },
    { id: "going-big", name: "Going Big", price: "Custom price", popular: false, image: "package-goingbig",
      includes: ["Full weddings, resort campaigns and multi-location events", "Crew, schedule and deliverables planned around your brief", "Drone, talent and styling quoted as needed", "No fixed hours or deliverable counts", "Timeline agreed in the quote"] }
  ],

  portfolio: [
    { title: "Beach wedding ceremony", category: "Weddings & Events", image_url: "https://picsum.photos/seed/wedding-1/600/600", full_url: "https://picsum.photos/seed/wedding-1/1200/1200", alt: "Beach wedding ceremony at sunset" },
    { title: "Couple portrait by the water", category: "Weddings & Events", image_url: "https://picsum.photos/seed/wedding-2/600/600", full_url: "https://picsum.photos/seed/wedding-2/1200/1200", alt: "Couple portrait by the water" },
    { title: "Event celebration with guests", category: "Weddings & Events", image_url: "https://picsum.photos/seed/wedding-3/600/600", full_url: "https://picsum.photos/seed/wedding-3/1200/1200", alt: "Event celebration with guests" },
    { title: "Resort brand lifestyle shot", category: "Brand & Product", image_url: "https://picsum.photos/seed/brand-1/600/600", full_url: "https://picsum.photos/seed/brand-1/1200/1200", alt: "Resort brand lifestyle shot" },
    { title: "Product flat-lay for social", category: "Brand & Product", image_url: "https://picsum.photos/seed/brand-2/600/600", full_url: "https://picsum.photos/seed/brand-2/1200/1200", alt: "Product flat-lay for social media" },
    { title: "Café interior brand photo", category: "Brand & Product", image_url: "https://picsum.photos/seed/brand-3/600/600", full_url: "https://picsum.photos/seed/brand-3/1200/1200", alt: "Café interior brand photography" },
    { title: "Graduation portrait outdoors", category: "Portraits", image_url: "https://picsum.photos/seed/portrait-1/600/600", full_url: "https://picsum.photos/seed/portrait-1/1200/1200", alt: "Graduation portrait outdoors" },
    { title: "Studio headshot", category: "Portraits", image_url: "https://picsum.photos/seed/portrait-2/600/600", full_url: "https://picsum.photos/seed/portrait-2/1200/1200", alt: "Studio headshot on dark background" },
    { title: "Family portrait on the beach", category: "Portraits", image_url: "https://picsum.photos/seed/portrait-3/600/600", full_url: "https://picsum.photos/seed/portrait-3/1200/1200", alt: "Family portrait on the beach" }
  ]
};
