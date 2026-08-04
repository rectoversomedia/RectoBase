-- =============================================================================
-- RectoBase PostgreSQL Schema
-- POS + CRM SaaS for Indonesian SMEs — "Bikin Pelanggan Balik Lagi"
-- Version: 1.0.0
-- =============================================================================

-- Enable UUID support
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- TABLE: tenants
-- Core merchant/organisation entity. All other tables reference this.
-- =============================================================================
CREATE TABLE tenants (
    id                        UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                      VARCHAR(255)     NOT NULL,
    slug                      VARCHAR(100)     NOT NULL UNIQUE,
    plan                      VARCHAR(20)      NOT NULL DEFAULT 'trial'
                                    CHECK (plan IN ('trial', 'starter', 'pro', 'business')),

    -- Plan limits
    max_outlets               INT              NOT NULL DEFAULT 1,
    max_staff                 INT              NOT NULL DEFAULT 5,
    max_customers             INT              NOT NULL DEFAULT 500,
    max_products              INT              NOT NULL DEFAULT 100,

    -- WhatsApp (Ultramsg / WA Gateway)
    whatsapp_limit            INT              NOT NULL DEFAULT 0,
    whatsapp_api_url          VARCHAR(500),
    whatsapp_instance_id      VARCHAR(100),
    whatsapp_token            VARCHAR(255),

    -- Tripay payment gateway
    tripay_api_key            VARCHAR(255),
    tripay_private_key        VARCHAR(255),
    tripay_merchant_code      VARCHAR(50),
    tripay_mode               VARCHAR(10)      NOT NULL DEFAULT 'sanbox'
                                    CHECK (tripay_mode IN ('sanbox', 'live')),

    -- Subscription
    subscription_status       VARCHAR(20)     NOT NULL DEFAULT 'trial'
                                    CHECK (subscription_status IN ('active', 'trial', 'expired', 'suspended')),
    subscription_expires_at    TIMESTAMPTZ,
    trial_starts_at           TIMESTAMPTZ,
    trial_ends_at             TIMESTAMPTZ,

    -- Audit & extras
    metadata                  JSONB            NOT NULL DEFAULT '{}',
    created_at                TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    deleted_at                TIMESTAMPTZ
);

CREATE INDEX idx_tenants_slug         ON tenants (slug);
CREATE INDEX idx_tenants_plan          ON tenants (plan);
CREATE INDEX idx_tenants_subscription  ON tenants (subscription_status, subscription_expires_at);

COMMENT ON TABLE tenants IS 'Core merchant/organisation entity. All other tables reference this (multi-tenant root).';
COMMENT ON COLUMN tenants.slug          IS 'URL-safe unique identifier, e.g. "warung-nusantara"';
COMMENT ON COLUMN tenants.plan          IS 'Billing tier: trial | starter | pro | business';
COMMENT ON COLUMN tenants.whatsapp_limit IS 'Monthly WhatsApp message budget (0 = no WhatsApp)';


-- =============================================================================
-- TABLE: outlets
-- Physical or logical store locations belonging to a tenant.
-- =============================================================================
CREATE TABLE outlets (
    id                UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id         UUID            NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name              VARCHAR(255)    NOT NULL,
    address           TEXT,
    phone             VARCHAR(20),
    email             VARCHAR(255),
    timezone          VARCHAR(50)     NOT NULL DEFAULT 'Asia/Jakarta',
    qr_menu_enabled   BOOLEAN         NOT NULL DEFAULT FALSE,
    qr_menu_url       VARCHAR(500),
    metadata          JSONB           NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at        TIMESTAMPTZ,

    CONSTRAINT outlets_tenant_name_uniq UNIQUE (tenant_id, name)
);

CREATE INDEX idx_outlets_tenant_id ON outlets (tenant_id);
CREATE INDEX idx_outlets_deleted   ON outlets (tenant_id, deleted_at);

COMMENT ON TABLE outlets IS 'Physical or logical store locations belonging to a tenant.';
COMMENT ON COLUMN outlets.timezone       IS 'IANA timezone string, default Asia/Jakarta for WIB.';
COMMENT ON COLUMN outlets.qr_menu_url    IS 'Public URL for the QR-code digital menu.';


-- =============================================================================
-- TABLE: users
-- Staff accounts (owner, manager, cashier, staff). References outlets optionally.
-- =============================================================================
CREATE TABLE users (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID            NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    outlet_id       UUID            REFERENCES outlets(id) ON DELETE SET NULL,
    email           VARCHAR(255)     NOT NULL UNIQUE,
    password_hash   VARCHAR(255)     NOT NULL,
    name            VARCHAR(255)     NOT NULL,
    phone           VARCHAR(20),
    role            VARCHAR(20)     NOT NULL DEFAULT 'cashier'
                                CHECK (role IN ('owner', 'manager', 'cashier', 'staff')),
    avatar_url      VARCHAR(500),
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    metadata        JSONB           NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_users_email      ON users (email);
CREATE INDEX idx_users_tenant_id  ON users (tenant_id);
CREATE INDEX idx_users_outlet_id  ON users (outlet_id);
CREATE INDEX idx_users_deleted    ON users (tenant_id, deleted_at);

COMMENT ON TABLE users IS 'Staff accounts. Owners can manage everything; cashiers only process orders.';
COMMENT ON COLUMN users.role       IS 'owner = full access; manager = outlet-level; cashier = POS only; staff = limited.';


-- =============================================================================
-- TABLE: categories
-- Product grouping (e.g. "Makanan", "Minuman", "Dessert").
-- =============================================================================
CREATE TABLE categories (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    icon        VARCHAR(50),              -- emoji, e.g. '🍜'
    sort_order  INT          NOT NULL DEFAULT 0,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ,

    CONSTRAINT categories_tenant_name_uniq UNIQUE (tenant_id, name)
);

CREATE INDEX idx_categories_tenant_id ON categories (tenant_id);
CREATE INDEX idx_categories_sort      ON categories (tenant_id, sort_order);

COMMENT ON TABLE categories IS 'Product grouping (e.g. "Makanan", "Minuman", "Dessert").';
COMMENT ON COLUMN categories.icon IS 'Emoji character for UI display.';


-- =============================================================================
-- TABLE: products
-- Menu / inventory items sold by a tenant.
-- =============================================================================
CREATE TABLE products (
    id                   UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id            UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    category_id          UUID           REFERENCES categories(id) ON DELETE SET NULL,
    name                 VARCHAR(255)   NOT NULL,
    sku                  VARCHAR(100),
    barcode              VARCHAR(100),
    description          TEXT,
    price                NUMERIC(12, 2) NOT NULL DEFAULT 0,
    cost_price           NUMERIC(12, 2) NOT NULL DEFAULT 0,
    stock_quantity       INT            NOT NULL DEFAULT 0,
    low_stock_threshold  INT            NOT NULL DEFAULT 5,
    image_url            VARCHAR(500),
    is_available         BOOLEAN        NOT NULL DEFAULT TRUE,
    is_featured          BOOLEAN        NOT NULL DEFAULT FALSE,
    sort_order           INT            NOT NULL DEFAULT 0,
    metadata             JSONB          NOT NULL DEFAULT '{}',
    created_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    deleted_at           TIMESTAMPTZ,

    CONSTRAINT products_tenant_sku_uniq     UNIQUE (tenant_id, sku)       WHERE sku IS NOT NULL,
    CONSTRAINT products_tenant_barcode_uniq  UNIQUE (tenant_id, barcode)   WHERE barcode IS NOT NULL,
    CONSTRAINT products_price_non_neg       CHECK (price >= 0),
    CONSTRAINT products_cost_non_neg        CHECK (cost_price >= 0),
    CONSTRAINT products_stock_non_neg       CHECK (stock_quantity >= 0)
);

CREATE INDEX idx_products_tenant_id   ON products (tenant_id);
CREATE INDEX idx_products_category_id ON products (category_id);
CREATE INDEX idx_products_sku         ON products (tenant_id, sku)       WHERE sku IS NOT NULL;
CREATE INDEX idx_products_barcode     ON products (tenant_id, barcode)   WHERE barcode IS NOT NULL;
CREATE INDEX idx_products_deleted     ON products (tenant_id, deleted_at);
CREATE INDEX idx_products_available   ON products (tenant_id, is_available) WHERE deleted_at IS NULL;

COMMENT ON TABLE products IS 'Menu / inventory items sold by a tenant.';
COMMENT ON COLUMN products.is_available    IS 'False = hidden from POS/menu but retained in order history.';
COMMENT ON COLUMN products.is_featured    IS 'Pin to top / featured carousel on customer-facing menu.';


-- =============================================================================
-- TABLE: product_variants
-- Size/flavor variants of a product (Reguler, Large; Coke, Sprite).
-- =============================================================================
CREATE TABLE product_variants (
    id                  UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id          UUID           NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name                VARCHAR(255)   NOT NULL,              -- e.g. "Reguler", "Large"
    sku_suffix          VARCHAR(50),
    barcode             VARCHAR(100),
    price_adjustment    NUMERIC(12, 2) NOT NULL DEFAULT 0,    -- added to parent product price
    stock_quantity      INT            NOT NULL DEFAULT 0,
    is_active           BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,

    CONSTRAINT product_variants_tenant_product_name_uniq UNIQUE (tenant_id, product_id, name)
);

CREATE INDEX idx_product_variants_product_id ON product_variants (product_id);
CREATE INDEX idx_product_variants_deleted    ON product_variants (tenant_id, deleted_at);

COMMENT ON TABLE product_variants IS 'Size/flavor variants of a product (Reguler, Large; Coke, Sprite).';
COMMENT ON COLUMN product_variants.price_adjustment IS 'Delta added to parent product price (can be negative for discounts).';


-- =============================================================================
-- TABLE: stock_movements
-- Audit trail for every stock change (restock, sale, adjustment, return, write-off).
-- =============================================================================
CREATE TABLE stock_movements (
    id              UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id      UUID           NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_id      UUID           REFERENCES product_variants(id) ON DELETE CASCADE,
    movement_type   VARCHAR(20)    NOT NULL
                                CHECK (movement_type IN ('in', 'out', 'adjustment', 'return', 'writeoff')),
    quantity        INT            NOT NULL,         -- negative for reductions
    reference_type  VARCHAR(50),                   -- e.g. 'order', 'adjustment_note', 'supplier'
    reference_id    UUID,                          -- e.g. order_id, adjustment_note_id
    note            TEXT,
    created_by      UUID           REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stock_movements_tenant_id  ON stock_movements (tenant_id);
CREATE INDEX idx_stock_movements_product_id ON stock_movements (product_id);
CREATE INDEX idx_stock_movements_variant_id ON stock_movements (variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX idx_stock_movements_created   ON stock_movements (tenant_id, created_at);
CREATE INDEX idx_stock_movements_type      ON stock_movements (tenant_id, movement_type);

COMMENT ON TABLE stock_movements IS 'Audit trail for all stock changes (restock, sale, adjustment, return, write-off).';
COMMENT ON COLUMN stock_movements.quantity IS 'Positive = increase; negative = decrease. Sign convention matters.';


-- =============================================================================
-- TABLE: customers
-- End-customer / member records. Phone is unique per tenant.
-- =============================================================================
CREATE TABLE customers (
    id                UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id         UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name              VARCHAR(255)   NOT NULL,
    phone             VARCHAR(20)    NOT NULL,
    email             VARCHAR(255),
    birthday          DATE,
    gender            VARCHAR(20)    CHECK (gender IN ('male', 'female', 'other')),
    address           TEXT,
    city              VARCHAR(100),
    notes             TEXT,
    customer_type     VARCHAR(20)    NOT NULL DEFAULT 'new'
                                CHECK (customer_type IN ('new', 'loyal', 'vip', 'at_risk', 'churned')),

    -- Loyalty & RFM
    loyalty_points    INT            NOT NULL DEFAULT 0,
    lifetime_value    NUMERIC(12, 2) NOT NULL DEFAULT 0,
    churn_score       INT            NOT NULL DEFAULT 50 CHECK (churn_score BETWEEN 0 AND 100),

    -- Order stats
    total_orders      INT            NOT NULL DEFAULT 0,
    avg_order_value   NUMERIC(12, 2) NOT NULL DEFAULT 0,
    last_order_at     TIMESTAMPTZ,
    last_visit_at     TIMESTAMPTZ,

    -- Tagging
    tags              TEXT[]         NOT NULL DEFAULT '{}',
    metadata          JSONB          NOT NULL DEFAULT '{}',

    created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    deleted_at        TIMESTAMPTZ,

    CONSTRAINT customers_tenant_phone_uniq UNIQUE (tenant_id, phone),
    CONSTRAINT customers_lifetime_value_non_neg CHECK (lifetime_value >= 0)
);

CREATE INDEX idx_customers_tenant_id      ON customers (tenant_id);
CREATE INDEX idx_customers_phone         ON customers (tenant_id, phone);
CREATE INDEX idx_customers_email          ON customers (tenant_id, email) WHERE email IS NOT NULL;
CREATE INDEX idx_customers_customer_type  ON customers (tenant_id, customer_type);
CREATE INDEX idx_customers_last_order_at  ON customers (tenant_id, last_order_at) WHERE last_order_at IS NOT NULL;
CREATE INDEX idx_customers_deleted        ON customers (tenant_id, deleted_at);
CREATE INDEX idx_customers_churn          ON customers (tenant_id, churn_score) WHERE deleted_at IS NULL;

COMMENT ON TABLE customers IS 'End-customer / member records. Phone is unique per tenant.';
COMMENT ON COLUMN customers.churn_score  IS 'ML-calculated 0-100 churn risk; updated by background jobs.';
COMMENT ON COLUMN customers.customer_type IS 'Auto-assigned by CRON based on RFM rules: new|loyal|vip|at_risk|churned.';


-- =============================================================================
-- TABLE: customer_addresses
-- Delivery addresses for customers who order online.
-- =============================================================================
CREATE TABLE customer_addresses (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id   UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    label         VARCHAR(100) NOT NULL,              -- e.g. "Rumah", "Kantor"
    address       TEXT        NOT NULL,
    city          VARCHAR(100),
    postal_code   VARCHAR(10),
    latitude      NUMERIC(10, 7),
    longitude     NUMERIC(10, 7),
    is_default    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customer_addresses_tenant_id   ON customer_addresses (tenant_id);
CREATE INDEX idx_customer_addresses_customer_id ON customer_addresses (customer_id);
CREATE INDEX idx_customer_addresses_default     ON customer_addresses (customer_id, is_default) WHERE is_default = TRUE;

COMMENT ON TABLE customer_addresses IS 'Delivery addresses for customers who order online.';


-- =============================================================================
-- TABLE: customer_activities
-- Granular activity/event log per customer for CRM scoring and personalisation.
-- =============================================================================
CREATE TABLE customer_activities (
    id            UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id   UUID           NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    activity_type VARCHAR(50)    NOT NULL
                            CHECK (activity_type IN (
                                'order', 'promo_received', 'promo_opened', 'promo_clicked',
                                'promo_redeemed', 'review', 'referral', 'birthday',
                                'loyalty_redeem', 'other'
                            )),
    description   TEXT,
    metadata      JSONB          NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customer_activities_customer_id ON customer_activities (customer_id);
CREATE INDEX idx_customer_activities_created     ON customer_activities (tenant_id, created_at);
CREATE INDEX idx_customer_activities_type        ON customer_activities (tenant_id, activity_type);
CREATE INDEX idx_customer_activities_tenant      ON customer_activities (tenant_id, customer_id, created_at DESC);

COMMENT ON TABLE customer_activities IS 'Granular activity/event log per customer for CRM scoring and personalisation.';


-- =============================================================================
-- TABLE: orders
-- POS order / transaction header. Order number is unique per tenant.
-- Format: OUTLETCODE-YYYYMMDD-XXXX  (e.g. MR-20240815-0031)
-- =============================================================================
CREATE TABLE orders (
    id                    UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id             UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    outlet_id             UUID           NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
    user_id               UUID           REFERENCES users(id) ON DELETE SET NULL,
    customer_id           UUID           REFERENCES customers(id) ON DELETE SET NULL,

    -- Numbering
    order_number          VARCHAR(50)    NOT NULL,

    -- Type & status
    order_type            VARCHAR(20)    NOT NULL DEFAULT 'dine_in'
                                CHECK (order_type IN ('dine_in', 'takeaway', 'delivery')),
    status                VARCHAR(20)    NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled', 'refunded')),

    -- Money
    subtotal              NUMERIC(12, 2) NOT NULL DEFAULT 0,
    tax_amount            NUMERIC(12, 2) NOT NULL DEFAULT 0,
    discount_amount       NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total                 NUMERIC(12, 2) NOT NULL DEFAULT 0,
    points_earned         INT            NOT NULL DEFAULT 0,
    points_redeemed       INT            NOT NULL DEFAULT 0,
    cash_redeemed         NUMERIC(12, 2) NOT NULL DEFAULT 0,

    -- Payment
    payment_method        VARCHAR(20)
                            CHECK (payment_method IN ('cash', 'card', 'qris', 'ewallet', 'multi')),
    payment_status        VARCHAR(20)    NOT NULL DEFAULT 'pending'
                                CHECK (payment_status IN ('pending', 'paid', 'partial', 'refunded')),
    payment_reference     VARCHAR(255),
    payment_amount        NUMERIC(12, 2) NOT NULL DEFAULT 0,

    -- Dine-in / customer info
    table_number          VARCHAR(20),
    customer_name         VARCHAR(255),
    customer_phone        VARCHAR(20),
    customer_notes        TEXT,

    -- Audit
    metadata              JSONB          NOT NULL DEFAULT '{}',
    created_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    completed_at          TIMESTAMPTZ,
    deleted_at            TIMESTAMPTZ,

    CONSTRAINT orders_tenant_number_uniq UNIQUE (tenant_id, order_number),
    CONSTRAINT orders_total_non_neg      CHECK (total >= 0),
    CONSTRAINT orders_subtotal_non_neg   CHECK (subtotal >= 0)
);

CREATE INDEX idx_orders_tenant_id      ON orders (tenant_id);
CREATE INDEX idx_orders_outlet_id       ON orders (outlet_id);
CREATE INDEX idx_orders_customer_id     ON orders (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_orders_user_id         ON orders (user_id);
CREATE INDEX idx_orders_status          ON orders (tenant_id, status);
CREATE INDEX idx_orders_created         ON orders (tenant_id, created_at);
CREATE INDEX idx_orders_order_number    ON orders (tenant_id, order_number);
CREATE INDEX idx_orders_deleted         ON orders (tenant_id, deleted_at);
CREATE INDEX idx_orders_completed       ON orders (tenant_id, completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX idx_orders_payment_status  ON orders (tenant_id, payment_status);

COMMENT ON TABLE orders IS 'POS order/transaction header. Order number is unique per tenant.';
COMMENT ON COLUMN orders.order_number  IS 'Format: OUTLETCODE-YYYYMMDD-XXXX  e.g. MR-20240815-0031';
COMMENT ON COLUMN orders.cash_redeemed IS 'Rp value of loyalty points redeemed (not the points themselves).';


-- =============================================================================
-- TABLE: order_items
-- Line items for an order. product_name and variant_name are denormalised for
-- historical accuracy (product/variant may be deleted or renamed later).
-- =============================================================================
CREATE TABLE order_items (
    id              UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id        UUID           NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id      UUID           NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_id      UUID           REFERENCES product_variants(id) ON DELETE SET NULL,
    product_name    VARCHAR(255)   NOT NULL,
    variant_name    VARCHAR(255),
    quantity        INT            NOT NULL CHECK (quantity > 0),
    unit_price      NUMERIC(12, 2) NOT NULL,
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    subtotal        NUMERIC(12, 2) NOT NULL,
    notes           TEXT,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_items_order_id   ON order_items (order_id);
CREATE INDEX idx_order_items_product_id ON order_items (product_id);
CREATE INDEX idx_order_items_variant_id ON order_items (variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX idx_order_items_tenant     ON order_items (tenant_id, order_id);

COMMENT ON TABLE order_items IS 'Line items for an order. Names are denormalised for historical accuracy.';
COMMENT ON COLUMN order_items.product_name  IS 'Snapshotted at order time — safe even if product is later deleted.';
COMMENT ON COLUMN order_items.discount_amount IS 'Per-line discount (item-level promotions, manual discounts).';


-- =============================================================================
-- TABLE: promotions
-- Campaign definitions: discounts, buy-X-get-Y, free-item, points bonus, etc.
-- =============================================================================
CREATE TABLE promotions (
    id                    UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id             UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name                  VARCHAR(255)   NOT NULL,
    description           TEXT,
    promo_type            VARCHAR(30)    NOT NULL
                                CHECK (promo_type IN (
                                    'discount_percent', 'discount_amount', 'buy_x_get_y',
                                    'free_item', 'points_bonus', 'loyalty_reward'
                                )),

    -- Discount params
    discount_value        NUMERIC(12, 2) NOT NULL DEFAULT 0,
    min_order_value       NUMERIC(12, 2) NOT NULL DEFAULT 0,
    max_discount          NUMERIC(12, 2),

    -- Buy-X-get-Y params
    buy_quantity          INT            NOT NULL DEFAULT 1,
    get_product_id        UUID           REFERENCES products(id) ON DELETE SET NULL,
    get_quantity          INT            NOT NULL DEFAULT 1,

    -- Audience targeting
    target_segment        VARCHAR(20)    NOT NULL DEFAULT 'all'
                                CHECK (target_segment IN ('all', 'new', 'vip', 'loyal', 'at_risk')),
    target_customer_ids   UUID[],

    -- Scheduling & limits
    starts_at             TIMESTAMPTZ    NOT NULL,
    ends_at               TIMESTAMPTZ    NOT NULL,
    usage_limit           INT,                        -- NULL = unlimited
    usage_count           INT            NOT NULL DEFAULT 0,
    is_repeatable         BOOLEAN        NOT NULL DEFAULT FALSE,
    max_uses_per_customer INT            NOT NULL DEFAULT 1,

    -- Status
    is_active             BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    deleted_at            TIMESTAMPTZ
);

CREATE INDEX idx_promotions_tenant_id  ON promotions (tenant_id);
CREATE INDEX idx_promotions_starts_at  ON promotions (tenant_id, starts_at);
CREATE INDEX idx_promotions_ends_at    ON promotions (tenant_id, ends_at);
CREATE INDEX idx_promotions_active     ON promotions (tenant_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_promotions_deleted    ON promotions (tenant_id, deleted_at);
CREATE INDEX idx_promotions_segment    ON promotions (tenant_id, target_segment);

COMMENT ON TABLE promotions IS 'Campaign definitions: discounts, buy-X-get-Y, free-item, points bonus, loyalty rewards.';
COMMENT ON COLUMN promotions.target_customer_ids IS 'If populated, only these customers can use this promotion.';
COMMENT ON COLUMN promotions.usage_limit        IS 'NULL = unlimited uses across all customers.';


-- =============================================================================
-- TABLE: promotion_recipients
-- Tracks which customers received a promotion and their engagement funnel.
-- =============================================================================
CREATE TABLE promotion_recipients (
    id                  UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    promotion_id        UUID           NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
    customer_id         UUID           NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

    -- Funnel timestamps
    sent_at             TIMESTAMPTZ,
    opened_at           TIMESTAMPTZ,
    clicked_at          TIMESTAMPTZ,
    redeemed_at         TIMESTAMPTZ,

    -- WA delivery
    whatsapp_message_id VARCHAR(255),
    status              VARCHAR(20)    NOT NULL DEFAULT 'sent'
                                CHECK (status IN ('sent', 'opened', 'clicked', 'redeemed', 'failed')),

    created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    CONSTRAINT promotion_recipients_tenant_promo_cust_uniq
        UNIQUE (tenant_id, promotion_id, customer_id)
);

CREATE INDEX idx_promotion_recipients_promotion_id ON promotion_recipients (promotion_id);
CREATE INDEX idx_promotion_recipients_customer_id  ON promotion_recipients (customer_id);
CREATE INDEX idx_promotion_recipients_status       ON promotion_recipients (tenant_id, status);
CREATE INDEX idx_promotion_recipients_tenant       ON promotion_recipients (tenant_id, promotion_id, status);

COMMENT ON TABLE promotion_recipients IS 'Tracks which customers received a promotion and their engagement funnel.';


-- =============================================================================
-- TABLE: loyalty_programs
-- Global loyalty scheme settings per tenant (points earning rate).
-- One active program per tenant at a time.
-- =============================================================================
CREATE TABLE loyalty_programs (
    id                    UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id             UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name                  VARCHAR(255)   NOT NULL,
    description           TEXT,
    points_per_rupiah     NUMERIC(4, 2)  NOT NULL DEFAULT 0.01,   -- 0.01 pts per Rp spent
    points_value          NUMERIC(12, 2) NOT NULL DEFAULT 100,     -- 100 pts = Rp X
    min_redemption_points INT            NOT NULL DEFAULT 100,
    is_active             BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_loyalty_programs_tenant_id  ON loyalty_programs (tenant_id);
CREATE INDEX idx_loyalty_programs_active     ON loyalty_programs (tenant_id, is_active) WHERE is_active = TRUE;

COMMENT ON TABLE loyalty_programs IS 'Global loyalty scheme settings per tenant. One active program per tenant.';
COMMENT ON COLUMN loyalty_programs.points_per_rupiah IS 'Points earned per Rupiah spent. E.g. 0.01 = 1 point per Rp 100.';
COMMENT ON COLUMN loyalty_programs.points_value      IS 'Rp value of 100 points. E.g. 100 = 100 pts = Rp 1,000 off.';


-- =============================================================================
-- TABLE: loyalty_rewards
-- Redeemable rewards for loyalty points (discount, free product, merchandise).
-- =============================================================================
CREATE TABLE loyalty_rewards (
    id                UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id         UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name              VARCHAR(255)   NOT NULL,
    description       TEXT,
    points_required   INT            NOT NULL CHECK (points_required > 0),
    reward_type       VARCHAR(30)   NOT NULL
                            CHECK (reward_type IN ('discount_percent', 'discount_amount', 'free_product', 'merchandise')),
    discount_value    NUMERIC(12, 2),
    free_product_id   UUID           REFERENCES products(id) ON DELETE SET NULL,
    stock_quantity    INT            NOT NULL DEFAULT 0,
    is_active         BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_loyalty_rewards_tenant_id ON loyalty_rewards (tenant_id);
CREATE INDEX idx_loyalty_rewards_active   ON loyalty_rewards (tenant_id, is_active) WHERE is_active = TRUE;

COMMENT ON TABLE loyalty_rewards IS 'Redeemable rewards for loyalty points (discount, free product, merchandise).';


-- =============================================================================
-- TABLE: vouchers
-- Manually created discount codes. Codes are uppercase, unique per tenant.
-- =============================================================================
CREATE TABLE vouchers (
    id                  UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code                VARCHAR(50)    NOT NULL,
    name                VARCHAR(255)   NOT NULL,
    voucher_type        VARCHAR(10)    NOT NULL CHECK (voucher_type IN ('percent', 'amount')),
    discount_value      NUMERIC(12, 2) NOT NULL,
    min_order_value     NUMERIC(12, 2) NOT NULL DEFAULT 0,
    max_discount        NUMERIC(12, 2),
    total_uses          INT            NOT NULL DEFAULT 0,
    max_uses            INT            NOT NULL,
    max_uses_per_customer INT          NOT NULL DEFAULT 1,
    starts_at           TIMESTAMPTZ    NOT NULL,
    ends_at             TIMESTAMPTZ    NOT NULL,
    is_active           BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,

    CONSTRAINT vouchers_tenant_code_uniq UNIQUE (tenant_id, code),
    CONSTRAINT vouchers_discount_positive CHECK (discount_value > 0)
);

CREATE INDEX idx_vouchers_tenant_id    ON vouchers (tenant_id);
CREATE INDEX idx_vouchers_code         ON vouchers (tenant_id, code);
CREATE INDEX idx_vouchers_active       ON vouchers (tenant_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_vouchers_dates        ON vouchers (tenant_id, starts_at, ends_at);

COMMENT ON TABLE vouchers IS 'Manually created discount codes. Codes are stored UPPERCASE and unique per tenant.';


-- =============================================================================
-- TABLE: payments
-- Payment transaction records, linked to orders and payment gateways.
-- Supports Tripay, Midtrans, and offline methods (cash, card, QRIS).
-- =============================================================================
CREATE TABLE payments (
    id                UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id         UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id          UUID           REFERENCES orders(id) ON DELETE CASCADE,
    payment_gateway   VARCHAR(20)
                            CHECK (payment_gateway IN ('tripay', 'midtrans', 'cash', 'card', 'qris')),
    reference         VARCHAR(255),
    method            VARCHAR(50),
    amount            NUMERIC(12, 2) NOT NULL,
    fee               NUMERIC(12, 2) NOT NULL DEFAULT 0,
    net_amount        NUMERIC(12, 2) NOT NULL,
    status            VARCHAR(20)    NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'refunded', 'cancelled')),
    callback_payload  JSONB,
    paid_at           TIMESTAMPTZ,
    created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    CONSTRAINT payments_amount_non_neg CHECK (amount >= 0),
    CONSTRAINT payments_fee_non_neg    CHECK (fee >= 0)
);

CREATE INDEX idx_payments_tenant_id   ON payments (tenant_id);
CREATE INDEX idx_payments_order_id     ON payments (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_payments_reference    ON payments (tenant_id, reference) WHERE reference IS NOT NULL;
CREATE INDEX idx_payments_status        ON payments (tenant_id, status);
CREATE INDEX idx_payments_gateway       ON payments (tenant_id, payment_gateway);
CREATE INDEX idx_payments_created       ON payments (tenant_id, created_at);

COMMENT ON TABLE payments IS 'Payment transaction records. Supports Tripay, Midtrans, and offline methods.';
COMMENT ON COLUMN payments.net_amount IS 'amount minus fee — what the merchant actually receives.';


-- =============================================================================
-- TABLE: whatsapp_messages
-- WhatsApp outbound message log. phone_number is in international format (e.g. 62812...).
-- =============================================================================
CREATE TABLE whatsapp_messages (
    id              UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id     UUID           REFERENCES customers(id) ON DELETE SET NULL,
    template_name   VARCHAR(100),
    phone_number    VARCHAR(20)    NOT NULL,
    message_body    TEXT           NOT NULL,
    media_url       VARCHAR(500),
    status          VARCHAR(20)    NOT NULL DEFAULT 'queued'
                            CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
    external_id     VARCHAR(255),
    error_message   TEXT,
    scheduled_at    TIMESTAMPTZ,
    sent_at         TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    read_at         TIMESTAMPTZ,
    metadata        JSONB          NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_whatsapp_messages_tenant_id   ON whatsapp_messages (tenant_id);
CREATE INDEX idx_whatsapp_messages_customer_id ON whatsapp_messages (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_whatsapp_messages_status      ON whatsapp_messages (tenant_id, status);
CREATE INDEX idx_whatsapp_messages_created     ON whatsapp_messages (tenant_id, created_at);
CREATE INDEX idx_whatsapp_messages_phone        ON whatsapp_messages (tenant_id, phone_number);
CREATE INDEX idx_whatsapp_messages_scheduled    ON whatsapp_messages (tenant_id, scheduled_at)
                                                    WHERE scheduled_at IS NOT NULL AND status = 'queued';

COMMENT ON TABLE whatsapp_messages IS 'WhatsApp outbound message log. Phone numbers in international format (e.g. 62812...).';


-- =============================================================================
-- TABLE: reports_daily
-- Pre-aggregated daily metrics per outlet. Refreshed by a nightly CRON job.
-- Used to power dashboards and analytics without hitting live tables.
-- =============================================================================
CREATE TABLE reports_daily (
    id                  UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    outlet_id           UUID           NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
    date                DATE           NOT NULL,
    total_orders        INT            NOT NULL DEFAULT 0,
    total_revenue       NUMERIC(12, 2) NOT NULL DEFAULT 0,
    avg_order_value     NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_customers     INT            NOT NULL DEFAULT 0,
    new_customers       INT            NOT NULL DEFAULT 0,
    returning_customers INT            NOT NULL DEFAULT 0,
    top_products        JSONB          NOT NULL DEFAULT '[]',
    payment_breakdown   JSONB         NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    CONSTRAINT reports_daily_tenant_outlet_date_uniq UNIQUE (tenant_id, outlet_id, date)
);

CREATE INDEX idx_reports_daily_tenant_outlet ON reports_daily (tenant_id, outlet_id);
CREATE INDEX idx_reports_daily_date          ON reports_daily (tenant_id, date);
CREATE INDEX idx_reports_daily_revenue       ON reports_daily (tenant_id, total_revenue) WHERE total_revenue > 0;

COMMENT ON TABLE reports_daily IS 'Pre-aggregated daily metrics per outlet. Refreshed by nightly CRON job.';
COMMENT ON COLUMN reports_daily.top_products       IS '[{"product_id":"...","name":"...","qty":42,"revenue":420000}, ...]';
COMMENT ON COLUMN reports_daily.payment_breakdown   IS '{"cash":150000,"qris":280000,"card":70000}';


-- =============================================================================
-- TABLE: settings
-- Key-value store for per-tenant configuration.
-- Type field lets the application know how to parse the value column.
-- =============================================================================
CREATE TABLE settings (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key         VARCHAR(100) NOT NULL,
    value       TEXT,
    type        VARCHAR(20)  NOT NULL DEFAULT 'string'
                            CHECK (type IN ('string', 'number', 'boolean', 'json')),
    description TEXT,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT settings_tenant_key_uniq UNIQUE (tenant_id, key)
);

CREATE INDEX idx_settings_tenant_id ON settings (tenant_id);
CREATE INDEX idx_settings_key       ON settings (tenant_id, key);

COMMENT ON TABLE settings IS 'Key-value store for per-tenant configuration. Type guides value parsing.';
COMMENT ON COLUMN settings.type IS 'string | number | boolean | json — application interprets value accordingly.';


-- =============================================================================
-- TABLE: notifications
-- In-app notifications surfaced to staff (low-stock alerts, subscription expiry, etc.).
-- =============================================================================
CREATE TABLE notifications (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
    type        VARCHAR(30) NOT NULL
                        CHECK (type IN (
                            'low_stock', 'subscription_expiry', 'promotion_result',
                            'new_customer', 'order', 'location_reminder', 'system'
                        )),
    title       VARCHAR(255) NOT NULL,
    body        TEXT,
    data        JSONB        NOT NULL DEFAULT '{}',
    is_read     BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    read_at     TIMESTAMPTZ
);

CREATE INDEX idx_notifications_tenant_id  ON notifications (tenant_id);
CREATE INDEX idx_notifications_user_id    ON notifications (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_notifications_read       ON notifications (tenant_id, is_read);
CREATE INDEX idx_notifications_created    ON notifications (tenant_id, created_at DESC);
CREATE INDEX idx_notifications_type       ON notifications (tenant_id, type);

COMMENT ON TABLE notifications IS 'In-app notifications surfaced to staff (low-stock, expiry, promotion results, etc.).';


-- =============================================================================
-- TRIGGER: auto-update updated_at on every table that has the column
-- =============================================================================

CREATE OR REPLACE FUNCTION rectobase_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to all tables that have the column
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT quote_ident(table_name)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'updated_at'
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_set_updated_at_on_%s ON %s;'
            'CREATE TRIGGER trg_set_updated_at_on_%s'
            '  BEFORE UPDATE ON %s'
            '  FOR EACH ROW EXECUTE FUNCTION rectobase_set_updated_at();',
            tbl, tbl, tbl, tbl
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql;


-- =============================================================================
-- TRIGGER: enforce UPPERCASE voucher codes on INSERT / UPDATE
-- =============================================================================

CREATE OR REPLACE FUNCTION rectobase_uppercase_voucher_code()
RETURNS TRIGGER AS $$
BEGIN
    NEW.code = UPPER(TRIM(NEW.code));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_vouchers_uppercase_code
    BEFORE INSERT OR UPDATE ON vouchers
    FOR EACH ROW EXECUTE FUNCTION rectobase_uppercase_voucher_code();


-- =============================================================================
-- SEED: Insert a demo tenant for local development
-- =============================================================================

INSERT INTO tenants (
    id, name, slug, plan,
    max_outlets, max_staff, max_customers, max_products,
    subscription_status, trial_starts_at, trial_ends_at,
    metadata
) VALUES (
    uuid_generate_v4(),
    'Demo Merchant',
    'demo-merchant',
    'trial',
    2, 10, 1000, 500,
    'trial',
    NOW(),
    NOW() + INTERVAL '14 days',
    '{"demo": true, "region": "jakarta"}'::jsonb
) ON CONFLICT (slug) DO NOTHING;

COMMENT ON TABLE tenants IS 'Multi-tenant root. Every table links back here via tenant_id.';
