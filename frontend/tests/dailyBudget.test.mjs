import assert from 'node:assert/strict';
import { dailyBudget } from '../src/dailyBudget.js';

const trip = { budget:1000,currency:'USD',startDate:'2026-11-09',endDate:'2026-11-12',
  categoryBudgets:{ Flights:300,Stay:200,Transit:100,Food:200,Activities:100,Buffer:100 },
  dailyCategories:['Food','Activities'],destinations:[] };
const initial = dailyBudget(trip, [], '2026-11-09');
assert.equal(initial.planned,300);
assert.equal(initial.target,75);
assert.equal(initial.remaining,300);
const prepaid = dailyBudget(trip,[{category:'Flights',amountBase:300,date:'2026-11-09'}],'2026-11-09');
assert.equal(prepaid.spentToday,0);
assert.equal(prepaid.target,75);
const lunch = dailyBudget(trip,[{category:'Food',amountBase:25,date:'2026-11-09'}],'2026-11-09');
assert.equal(lunch.spentToday,25);
assert.equal(lunch.leftToday,50);
assert.equal(lunch.remaining,275);
const overspend = dailyBudget(trip,[{category:'Flights',amountBase:900,date:'2026-11-09'}],'2026-11-09');
assert.ok(overspend.remaining < 0);
assert.equal(overspend.suggested,0);
assert.equal(dailyBudget({...trip,categoryBudgets:{}},[],'2026-11-09').target,null);
const multi = {...trip,destinations:[
  {id:'a',place:'Paris',startDate:'2026-11-09',endDate:'2026-11-10',priceLevel:{value:80}},
  {id:'b',place:'Bangkok',startDate:'2026-11-11',endDate:'2026-11-12',priceLevel:{value:40}}]};
assert.ok(dailyBudget(multi,[],'2026-11-09').target > initial.target);
assert.equal(dailyBudget(multi,[],'2026-11-11').destination.id,'b');
console.log('Daily budget checks passed: fixed costs, reserve, overspending, unplanned trips and country weights.');
