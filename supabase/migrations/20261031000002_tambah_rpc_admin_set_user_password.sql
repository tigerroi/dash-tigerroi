-- ==============================================================================
-- Migrasi RPC Ganti Password User Khusus Superadmin (TigerROI)
-- Fungsi aman (SECURITY DEFINER) untuk memungkinkan Superadmin mengganti
-- password anggota tim langsung dari antarmuka dashboard TigerROI.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.admin_set_user_password(target_user_id uuid, new_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  caller_role text;
  caller_email text;
BEGIN
  -- 1. Verifikasi bahwa sesi pemanggil aktif
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Akses ditolak: Anda harus login terlebih dahulu.';
  END IF;

  -- 2. Ambil role dan email pemanggil dari tabel profiles & auth.users
  SELECT role INTO caller_role
  FROM public.profiles
  WHERE id = auth.uid();

  SELECT email INTO caller_email
  FROM auth.users
  WHERE id = auth.uid();

  -- 3. Pastikan hanya Superadmin yang memiliki izin eksekusi
  IF (caller_role IS NULL OR caller_role NOT ILIKE '%superadmin%')
     AND (caller_email IS NULL OR caller_email NOT ILIKE '%superadmin%') THEN
    RAISE EXCEPTION 'Akses ditolak: Hanya Superadmin yang diizinkan mengubah password anggota tim.';
  END IF;

  -- 4. Validasi panjang password baru
  IF new_password IS NULL OR length(trim(new_password)) < 6 THEN
    RAISE EXCEPTION 'Password baru minimal harus 6 karakter.';
  END IF;

  -- 5. Perbarui password terenkripsi di tabel auth.users
  UPDATE auth.users
  SET encrypted_password = crypt(trim(new_password), gen_salt('bf')),
      updated_at = now()
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pengguna dengan ID tersebut tidak ditemukan di sistem autentikasi.';
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Password pengguna berhasil diperbarui.');
END;
$$;

-- Berikan izin eksekusi kepada pengguna yang telah terautentikasi (pemeriksaan superadmin dilakukan di dalam fungsi)
GRANT EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) TO authenticated;
