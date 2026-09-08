// services/menuCatalog.js
// Centralized Product & Menu Catalog with Indian Rupee (INR / ₹) prices.

export const MENU_CATALOG = [
  {
    id: 'burger',
    name: 'Double Smash Burger',
    aliases: ['burger', 'cheeseburger', 'double smash', 'double smash combo', 'smash burger', 'two double cheeseburgers'],
    price: 249,
    emoji: '🍔',
    sub: 'Double patty & melted cheese',
    category: 'mains'
  },
  {
    id: 'fries',
    name: 'Crispy Fries',
    aliases: ['fries', 'salted fries', 'french fries', 'large fries', 'crispy fries'],
    price: 99,
    emoji: '🍟',
    sub: 'Golden & sea salted',
    category: 'sides'
  },
  {
    id: 'coke',
    name: 'Classic Coke',
    aliases: ['coke', 'classic coke', 'coca cola', 'diet coke', 'sprite', 'cold drink', 'soda', 'beverage'],
    price: 79,
    emoji: '🥤',
    sub: 'Chilled • Light ice',
    category: 'drinks'
  },
  {
    id: 'nuggets',
    name: 'Chicken Nuggets',
    aliases: ['nuggets', 'chicken nuggets', 'crispy nuggets', 'wings', 'chicken wings'],
    price: 149,
    emoji: '🍗',
    sub: 'With tangy dipping sauce',
    category: 'sides'
  },
  {
    id: 'dessert',
    name: 'Choco Lava Dessert',
    aliases: ['dessert', 'choco lava', 'choco lava dessert', 'chocolate shake', 'shake', 'ice cream', 'desserts'],
    price: 129,
    emoji: '🍨',
    sub: 'Warm molten chocolate',
    category: 'desserts'
  },
  {
    id: 'pizza',
    name: 'Large Pepperoni Pizza',
    aliases: ['pizza', 'pepperoni pizza', 'margherita', 'large pepperoni pizza', 'large pizza'],
    price: 399,
    emoji: '🍕',
    sub: 'Extra crispy crust • Hot & fresh',
    category: 'mains'
  },
  {
    id: 'tenders',
    name: 'Crispy Chicken Tenders',
    aliases: ['tenders', 'chicken tenders', 'crispy tenders'],
    price: 199,
    emoji: '🍗',
    sub: 'With honey mustard sauce',
    category: 'mains'
  },
  {
    id: 'garlic_bread',
    name: 'Garlic Bread',
    aliases: ['garlic bread', 'garlic toast'],
    price: 119,
    emoji: '🥖',
    sub: 'Toasted with herb butter',
    category: 'sides'
  }
];

export const DEFAULT_RECOMMENDATIONS = [
  { id: 'coke', name: 'Classic Coke', price: 79, emoji: '🥤', sub: 'Chilled • Light ice', badge: 'POPULAR' },
  { id: 'nuggets', name: 'Chicken Nuggets', price: 149, emoji: '🍗', sub: 'With tangy dip', badge: 'SNACK' },
  { id: 'dessert', name: 'Choco Lava Dessert', price: 129, emoji: '🍨', sub: 'Molten chocolate', badge: 'SWEET' },
  { id: 'fries', name: 'Crispy Fries', price: 99, emoji: '🍟', sub: 'Golden sea salted', badge: 'CRUNCH' },
  { id: 'garlic_bread', name: 'Garlic Bread', price: 119, emoji: '🥖', sub: 'Toasted herb butter', badge: 'WARM' }
];

export function formatINR(amount) {
  const numeric = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
  return '₹' + Math.round(numeric).toLocaleString('en-IN');
}

export function findMenuItem(query) {
  if (!query) return null;
  const lower = query.toLowerCase().trim();

  // 1. Direct name match
  for (const item of MENU_CATALOG) {
    if (item.name.toLowerCase() === lower || item.id.toLowerCase() === lower) {
      return item;
    }
  }

  // 2. Alias match
  for (const item of MENU_CATALOG) {
    for (const alias of item.aliases) {
      if (lower === alias || lower.includes(alias) || alias.includes(lower)) {
        return item;
      }
    }
  }

  return null;
}

export function getCanonicalItemName(query) {
  const found = findMenuItem(query);
  return found ? found.name : query;
}
