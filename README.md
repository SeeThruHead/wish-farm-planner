# @seethruhead/wish-farm-planner

Plan your discretionary spending with a YNAB-style wish farm. Uses [`@seethruhead/cra-payroll`](https://www.npmjs.com/package/@seethruhead/cra-payroll) to determine your real take-home pay, subtracts your monthly expenses, and shows you exactly which YNAB categories to fund each paycheck.

## Install

```bash
npm install -g @seethruhead/wish-farm-planner
```

Requires `cra-payroll` in your PATH:

```bash
npm install -g @seethruhead/cra-payroll
```

## Config

Create `wish-farm.json` (or `~/.config/wish-farm.json` or `~/.wish-farm.json`):

```json
{
  "monthlyExpenses": 5000,
  "wishes": [
    { "name": "Mac Studio", "cost": 2999, "priority": 1 },
    { "name": "DAC/Amp", "cost": 899, "priority": 2 },
    { "name": "Headphones", "cost": 1599, "priority": 3 },
    { "name": "Motorcycle", "cost": 12000, "priority": 4 }
  ],
  "craPayrollArgs": {
    "salary": 263000,
    "province": "Ontario",
    "rrspMatch": 4,
    "rrspUnmatched": 0
  }
}
```

**`monthlyExpenses`** — everything you spend in a month: rent, food, bills, subscriptions, investment transfers. The money left after this is truly discretionary.

**`wishes`** — your wish farm items, prioritized (1 = buy first).

**`craPayrollArgs`** — passed to `cra-payroll` to compute your take-home.

## Usage

### Per-paycheck allocation table

```bash
wish-farm-planner paychecks
```

Shows which YNAB categories to fund each paycheck, with rollover when items are funded mid-paycheck:

```
Paycheck Allocation (Sequential)
══════════════════════════════════════════════════════════════════════════════════
    #    Take Home     Expenses  Discretion.  │  YNAB Categories
──────────────────────────────────────────────────────────────────────────────────
    1    $6,008.01    $2,500.00    $3,508.01  │  $2,999.00 → Mac Studio ✓  │  $509.01 → DAC/Amp
    2    $6,008.01    $2,500.00    $3,508.01  │  $389.99 → DAC/Amp ✓  │  $1,599.00 → Headphones ✓  │  $1,519.02 → Motorcycle
    3    $6,008.01    $2,500.00    $3,508.01  │  $3,508.01 → Motorcycle
    ...

Funding Timeline
──────────────────────────────────────────────────────────────────────────
  ✓ Mac Studio               funded by paycheck #1
  ✓ DAC/Amp                  funded by paycheck #2
  ✓ Headphones               funded by paycheck #2
  ✓ Motorcycle               funded by paycheck #5
```

### Monthly summary

```bash
wish-farm-planner plan
wish-farm-planner plan -s proportional
```

### JSON output

Every command supports `--json` for integration with other tools:

```bash
wish-farm-planner paychecks --json
wish-farm-planner plan --json
```

### Options

```
wish-farm-planner paychecks [options]
  -c, --config <path>    Path to config file
  --json                 Output as JSON

wish-farm-planner plan [options]
  -c, --config <path>    Path to config file
  -s, --strategy         sequential (default) or proportional
  --json                 Output as JSON
```

## How it works

1. Calls `cra-payroll --table --json` to get per-paycheck take-home pay (accounts for CPP/EI maxing out later in the year)
2. Subtracts your per-paycheck share of monthly expenses
3. Allocates the discretionary remainder to wish items in priority order
4. When an item is fully funded mid-paycheck, leftover rolls to the next item

## Development

```bash
bun install
bun test
bun run dev -- paychecks -c test-config.json
```

## License

MIT
