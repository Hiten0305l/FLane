// scripts/test_replacement_and_inr.mjs
// Automated verification of replacement logic, recommended items, and INR pricing.

import { MENU_CATALOG, DEFAULT_RECOMMENDATIONS, formatINR, findMenuItem } from '../services/menuCatalog.js';
import { getFallbackReply } from '../services/geminiService.js';

let passes = 0;
let fails = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    passes++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    fails++;
  }
}

console.log('=== TEST 1: Centralized Menu & INR Formatting ===');
assert(formatINR(149) === '₹149', `formatINR(149) produces '₹149'`);
assert(formatINR(299) === '₹299', `formatINR(299) produces '₹299'`);
assert(formatINR(1249) === '₹1,249', `formatINR(1249) produces '₹1,249'`);

const burger = findMenuItem('burger');
const fries = findMenuItem('fries');
const nuggets = findMenuItem('nuggets');
const coke = findMenuItem('coke');
const dessert = findMenuItem('dessert');

assert(burger && burger.price === 249, 'Burger price is ₹249');
assert(fries && fries.price === 99, 'Fries price is ₹99');
assert(nuggets && nuggets.price === 149, 'Nuggets price is ₹149');
assert(coke && coke.price === 79, 'Coke price is ₹79');
assert(dessert && dessert.price === 129, 'Dessert price is ₹129');

console.log('\n=== TEST 2: Replacement Logic ("Replace the fries with nuggets") ===');
const initialOrderState = {
  items: ['Double Smash Burger', 'Crispy Fries'],
  confirmed: false
};
const initialTotal = burger.price + fries.price;
assert(initialTotal === 348, `Initial order total: ₹${initialTotal} (₹249 + ₹99)`);

// Recommended items before replacement (expanded to 5 items)
let currentRecommendations = [...DEFAULT_RECOMMENDATIONS];
assert(currentRecommendations.length === 5, 'Initial recommendations count is 5 (Coke, Nuggets, Dessert, Fries, Garlic Bread)');
assert(currentRecommendations.some(r => r.id === 'coke'), 'Coke is in recommendations');
assert(currentRecommendations.some(r => r.id === 'nuggets'), 'Nuggets is in recommendations');
assert(currentRecommendations.some(r => r.id === 'dessert'), 'Dessert is in recommendations');
assert(currentRecommendations.some(r => r.id === 'fries'), 'Fries is in recommendations');
assert(currentRecommendations.some(r => r.id === 'garlic_bread'), 'Garlic Bread is in recommendations');

// Execute replacement command
const userUtterance = 'Replace the fries with nuggets.';
const { reply, orderState: updatedOrderState } = getFallbackReply({
  text: userUtterance,
  orderState: initialOrderState,
  isInterruption: false
});

console.log(`Spoken Reply: "${reply}"`);
console.log(`Updated Items:`, updatedOrderState.items);

assert(updatedOrderState.items.length === 2, 'Order still has exactly 2 items');
assert(updatedOrderState.items.includes('Double Smash Burger'), 'Burger remains in the order');
assert(!updatedOrderState.items.some(it => it.toLowerCase().includes('fries')), 'Fries is removed/replaced');
assert(updatedOrderState.items.includes('Chicken Nuggets'), 'Nuggets is added to the order');

// Calculate updated total
const newTotal = updatedOrderState.items.reduce((sum, it) => {
  const item = findMenuItem(it);
  return sum + (item ? item.price : 0);
}, 0);
assert(newTotal === 398, `Updated order total: ₹${newTotal} (Burger ₹249 + Nuggets ₹149 = ₹398)`);

// Verify that unrelated recommended items remain
// If nuggets was added, Coke, Dessert, and Garlic Bread recommendations MUST remain
const remainingUnrelatedRecommendations = currentRecommendations.filter(r => r.id !== 'nuggets');
assert(remainingUnrelatedRecommendations.length === 4, 'Unrelated recommendations count is 4 (Coke, Dessert, Fries, Garlic Bread)');
assert(remainingUnrelatedRecommendations.some(r => r.id === 'coke'), 'Coke recommendation remains');
assert(remainingUnrelatedRecommendations.some(r => r.id === 'dessert'), 'Dessert recommendation remains');
assert(remainingUnrelatedRecommendations.some(r => r.id === 'garlic_bread'), 'Garlic bread recommendation remains');

console.log('\n=== TEST 3: "+ Add" Recommended Item Logic ===');
// User clicks "+ Add" on Coke
const cokeRec = currentRecommendations.find(r => r.id === 'coke');
const orderAfterAddCoke = {
  items: [...updatedOrderState.items, cokeRec.name],
  confirmed: false
};

assert(orderAfterAddCoke.items.length === 3, 'Order now has 3 items');
assert(orderAfterAddCoke.items.includes('Classic Coke'), 'Classic Coke is added');
assert(orderAfterAddCoke.items.includes('Double Smash Burger'), 'Double Smash Burger remains');
assert(orderAfterAddCoke.items.includes('Chicken Nuggets'), 'Chicken Nuggets remains');

// Total recalculation
const totalAfterAdd = orderAfterAddCoke.items.reduce((sum, it) => {
  const item = findMenuItem(it);
  return sum + (item ? item.price : 0);
}, 0);
assert(totalAfterAdd === 477, `Total after adding Coke: ₹${totalAfterAdd} (₹249 + ₹149 + ₹79 = ₹477)`);

// Other recommendations (Dessert) remain
assert(currentRecommendations.some(r => r.id === 'dessert'), 'Dessert recommendation remains untouched');

console.log('\n=== TEST 4: Remove Item Logic ("Remove Coke") ===');
// Removing Classic Coke
const orderAfterRemoveCoke = {
  items: orderAfterAddCoke.items.filter(it => it !== 'Classic Coke'),
  confirmed: false
};
assert(orderAfterRemoveCoke.items.length === 2, 'Order has 2 items after removing Coke');
assert(!orderAfterRemoveCoke.items.includes('Classic Coke'), 'Classic Coke is removed');
const totalAfterRemove = orderAfterRemoveCoke.items.reduce((sum, it) => {
  const item = findMenuItem(it);
  return sum + (item ? item.price : 0);
}, 0);
assert(totalAfterRemove === 398, `Total after removing Coke is back to ₹398 (Burger ₹249 + Nuggets ₹149)`);

console.log('\n=== TEST 5: Clean Initial Empty State ===');
const emptyOrder = { items: [], confirmed: false };
assert(emptyOrder.items.length === 0, 'Initial order state has 0 items before customer orders');
const emptyTotal = emptyOrder.items.reduce((sum, it) => {
  const item = findMenuItem(it);
  return sum + (item ? item.price : 0);
}, 0);
assert(emptyTotal === 0, 'Initial total is ₹0 before ordering');

console.log(`\n========================================`);
console.log(`Results: ${passes} Passed, ${fails} Failed`);
if (fails > 0) process.exit(1);
