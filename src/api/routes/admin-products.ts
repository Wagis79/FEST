/**
 * FEST - Admin Product Routes
 * CRUD operations for products
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import log from '../../utils/logger';
import { 
  supabase,
  supabaseAdmin,
  PRODUCTS_TABLE, 
  dbProductToProduct, 
  productToDBProduct,
  type DBProduct,
} from '../supabase';
import { requireAdminPassword } from '../middleware';

const router = Router();

/** Helper to extract error message from unknown error */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * GET /api/admin/products
 * Fetch all products from database
 */
router.get('/', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from(PRODUCTS_TABLE)
      .select('*')
      .order('Produkt', { ascending: true });

    if (error) {
      log.error('Supabase error fetching products', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch products from database',
        details: getErrorMessage(error),
      });
    }

    res.json(data || []);
  } catch (error) {
    log.error('Server error in admin products', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: getErrorMessage(error),
    });
  }
});

/**
 * POST /api/admin/products
 * Add a new product
 */
router.post('/', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const product = req.body;

    let dbProduct: Partial<DBProduct>;
    if (product.Artikelnr !== undefined && product.Produkt !== undefined) {
      dbProduct = { ...product };
      delete dbProduct.idx;
    } else {
      if (!product.id || !product.name || product.pricePerKg === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: id, name, pricePerKg',
        });
      }
      dbProduct = productToDBProduct(product);
    }

    const { data, error } = await supabaseAdmin
      .from(PRODUCTS_TABLE)
      .insert([dbProduct])
      .select()
      .single();

    if (error) {
      log.error('Supabase error', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to add product to database',
        details: getErrorMessage(error),
      });
    }

    res.json({
      success: true,
      message: 'Product added successfully',
      product: dbProductToProduct(data),
    });
  } catch (error) {
    log.error('Server error', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: getErrorMessage(error),
    });
  }
});

/**
 * PUT /api/admin/products/:id
 * Update an existing product
 */
router.put('/:id', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const product = req.body;

    const artikelnr = parseInt(id.replace('prod-', ''));

    let dbProduct: Partial<DBProduct>;
    if (product.Artikelnr !== undefined) {
      dbProduct = { ...product };
      delete dbProduct.Artikelnr;
      delete dbProduct.idx;
    } else {
      dbProduct = productToDBProduct(product);
    }

    const { data, error } = await supabaseAdmin
      .from(PRODUCTS_TABLE)
      .update(dbProduct)
      .eq('Artikelnr', artikelnr)
      .select()
      .single();

    if (error) {
      log.error('Supabase error', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to update product in database',
        details: getErrorMessage(error),
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        error: `Product with id '${id}' not found`,
      });
    }

    res.json({
      success: true,
      message: 'Product updated successfully',
      product: dbProductToProduct(data),
    });
  } catch (error) {
    log.error('Server error', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: getErrorMessage(error),
    });
  }
});

/**
 * DELETE /api/admin/products/:id
 * Delete a product
 */
router.delete('/:id', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const artikelnr = parseInt(id.replace('prod-', ''));

    const { error } = await supabaseAdmin
      .from(PRODUCTS_TABLE)
      .delete()
      .eq('Artikelnr', artikelnr);

    if (error) {
      log.error('Supabase error', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to delete product from database',
        details: getErrorMessage(error),
      });
    }

    res.json({
      success: true,
      message: 'Product deleted successfully',
      productId: id,
    });
  } catch (error) {
    log.error('Server error', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: getErrorMessage(error),
    });
  }
});

export default router;
