export interface MediaPreset {
  id: string;
  title: string;
  category: 'movie' | 'image' | 'audio';
  url: string;
  description: string;
  thumbnail: string;
}

export const MEDIA_PRESETS: MediaPreset[] = [
  // Movies & Short Films
  {
    id: 'movie-bigbuckbunny',
    title: 'Big Buck Bunny (Animated Movie)',
    category: 'movie',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    description: 'Blender Foundation animated classic short film in full HD',
    thumbnail: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'movie-tearsofsteel',
    title: 'Tears of Steel (Sci-Fi VFX Movie)',
    category: 'movie',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    description: 'Dystopian sci-fi short set in future Amsterdam',
    thumbnail: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'movie-elephantsdream',
    title: 'Elephants Dream (Sci-Fi Animation)',
    category: 'movie',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    description: 'Surreal cinematic journey through a mechanical labyrinth',
    thumbnail: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'movie-sintel',
    title: 'Sintel (Fantasy CGI Story)',
    category: 'movie',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    description: 'Epic emotional fantasy about a young warrior searching for her dragon',
    thumbnail: 'https://images.unsplash.com/photo-1514533450685-4493e01d1fdc?w=400&auto=format&fit=crop&q=80'
  },

  // Photos & High-Res Wallpapers
  {
    id: 'photo-nebula',
    title: 'Deep Cosmic Nebula (Space 4K)',
    category: 'image',
    url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1600&auto=format&fit=crop&q=80',
    description: 'Vibrant interstellar clouds and stellar nurseries',
    thumbnail: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'photo-cyberpunk',
    title: 'Cyberpunk Metropolis Night',
    category: 'image',
    url: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=1600&auto=format&fit=crop&q=80',
    description: 'Neon-lit futuristic skyscraper district in the rain',
    thumbnail: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'photo-aurora',
    title: 'Aurora Borealis Glaciers',
    category: 'image',
    url: 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=1600&auto=format&fit=crop&q=80',
    description: 'Spectacular green and purple northern lights over frozen waters',
    thumbnail: 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'photo-lake',
    title: 'Alpine Emerald Lake Sunset',
    category: 'image',
    url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1600&auto=format&fit=crop&q=80',
    description: 'Crystal reflections and towering jagged mountain peaks',
    thumbnail: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&auto=format&fit=crop&q=80'
  }
];
