/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 */

/**
 * Strategier för gödselrekommendationer
 */

export type Strategy = 'economic' | 'optimized';

/**
 * economic: Prioriterar lägsta kostnad, tillåter övergödsling
 * optimized: Prioriterar precision och balans mellan näringsämnen
 */
