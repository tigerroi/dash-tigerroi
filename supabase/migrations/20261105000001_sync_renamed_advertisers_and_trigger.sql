-- ==============================================================================
-- Migrasi: Sinkronkan Pergantian Nama Advertiser & Buat Trigger Otomatis
-- ==============================================================================

-- 1. Sinkronkan data saat ini
UPDATE subdomains SET pic = 'Austin' WHERE pic = 'Ade Suparman';
UPDATE subdomains SET pic = 'Moskov' WHERE pic = 'Mulyana';
UPDATE subdomains SET pic = 'Sullivan' WHERE pic = 'Zulfan';
UPDATE subdomains SET pic = 'New York City' WHERE pic = 'Nurjaman';
UPDATE subdomains SET pic = 'Crissthoper' WHERE pic = 'Cris';

UPDATE ad_accounts 
SET user_owner = REPLACE(
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(user_owner, 'Ade Suparman', 'Austin'),
        'Cris', 'Crissthoper'
      ),
      'Zulfan', 'Sullivan'
    ),
    'Mulyana', 'Moskov'
  ),
  'Nurjaman', 'New York City'
)
WHERE user_owner IS NOT NULL;

-- 2. Buat fungsi trigger untuk cascade update nama PIC otomatis di masa mendatang
CREATE OR REPLACE FUNCTION handle_profile_name_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name AND OLD.name IS NOT NULL AND NEW.name IS NOT NULL THEN
    -- Update PIC di tabel subdomains
    UPDATE subdomains
    SET pic = NEW.name
    WHERE pic = OLD.name;

    -- Update nama di ad_accounts.user_owner
    UPDATE ad_accounts
    SET user_owner = REPLACE(user_owner, OLD.name, NEW.name)
    WHERE user_owner LIKE '%' || OLD.name || '%';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Pasang trigger ke tabel profiles
DROP TRIGGER IF EXISTS tr_profile_name_change ON profiles;
CREATE TRIGGER tr_profile_name_change
AFTER UPDATE OF name ON profiles
FOR EACH ROW
EXECUTE FUNCTION handle_profile_name_change();
