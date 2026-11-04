#requires -Version 7.0
<#
Restauración verificable de un respaldo RAW de PostgreSQL de ULIT Censo.
ENTORNO: PostgreSQL Docker efímero SIN RED; NUNCA Supabase producción.
Comprueba SHA-256, SQL completo, inventario de datos y estructura lógica.
NO prueba servicios Auth/Storage, roles globales, JWT, SMTP ni Edge Functions.
Uso: .\20261104_9201_prueba_restauracion.ps1 -Dump "C:\...\censo-comercios-...dump"
#>
param(
    [Parameter(Mandatory = $true)][string]$Dump,
    [string]$InventorySql = (Join-Path $PSScriptRoot '20261104_9102_inventario_datos.sql')
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$Dump = (Resolve-Path -LiteralPath $Dump).Path
foreach ($path in @($Dump, "$Dump.sha256", "$Dump.inventario", $InventorySql)) {
    if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw "Falta: $path" }
}
$checksum = ((Get-Content -LiteralPath "$Dump.sha256" -TotalCount 1) -split '\s+')[0]
if ((Get-FileHash -LiteralPath $Dump -Algorithm SHA256).Hash -ine $checksum) {
    throw 'El SHA-256 del respaldo no coincide. Abortado.'
}
Write-Host 'RESPALDO INTEGRO'
$nombre = 'ulit-verifica-' + [guid]::NewGuid().ToString('N').Substring(0, 10)
$clave = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
$rolesArchivo = Join-Path $env:TEMP ($nombre + '-roles.sql')
$log = "$Dump.restauracion-local.log"
$inventarioRestaurado = "$Dump.inventario-restaurado"
$iniciado = $false
try {
    Write-Host '=== INICIANDO POSTGRESQL DESECHABLE SIN RED ==='
    & docker run -d --rm --network none --name $nombre -e "POSTGRES_PASSWORD=$clave" -e 'POSTGRES_USER=supabase_admin' -e 'POSTGRES_DB=postgres' supabase/postgres:17.6.1.043 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar Docker.' }
    $iniciado = $true
    $disponible = $false
    for ($i = 0; $i -lt 45; $i++) {
        $r = & docker exec -e "PGPASSWORD=$clave" $nombre psql -w -h 127.0.0.1 -U supabase_admin -d postgres -X -At -c 'SELECT 1' 2>$null
        if ($LASTEXITCODE -eq 0 -and $r -eq '1') { $disponible = $true; break }
        Start-Sleep -Seconds 2
    }
    if (!$disponible) { throw 'El PostgreSQL temporal no responde.' }
    $roles = @'
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY[
        'anon', 'authenticated', 'authenticator', 'cli_login_postgres',
        'dashboard_user', 'pgbouncer', 'postgres', 'service_role',
        'supabase_admin', 'supabase_auth_admin', 'supabase_etl_admin',
        'supabase_functions_admin', 'supabase_privileged_role',
        'supabase_read_only_user', 'supabase_realtime_admin',
        'supabase_replication_admin', 'supabase_storage_admin'
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('CREATE ROLE %I NOLOGIN', r);
        END IF;
    END LOOP;
END
$$;
'@
    [IO.File]::WriteAllText($rolesArchivo, $roles, [Text.UTF8Encoding]::new($false))
    & docker cp $rolesArchivo ($nombre + ':/tmp/roles.sql') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Error copiando roles.' }
    & docker exec -e "PGPASSWORD=$clave" $nombre psql -w -h 127.0.0.1 -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1 -f /tmp/roles.sql | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Error creando roles de prueba.' }
    & docker exec -e "PGPASSWORD=$clave" $nombre createdb -w -h 127.0.0.1 -U supabase_admin -T template0 ulit_verificacion
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la base vacía.' }
    & docker exec -e "PGPASSWORD=$clave" $nombre psql -w -h 127.0.0.1 -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET cron.database_name = 'ulit_verificacion';" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Error configurando pg_cron.' }
    & docker restart $nombre | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Error reiniciando el contenedor.' }
    $cron = $false
    for ($i = 0; $i -lt 45; $i++) {
        $r = & docker exec -e "PGPASSWORD=$clave" $nombre psql -w -h 127.0.0.1 -U supabase_admin -d postgres -X -At -c "SELECT current_setting('cron.database_name');" 2>$null
        if ($LASTEXITCODE -eq 0 -and $r -eq 'ulit_verificacion') { $cron = $true; break }
        Start-Sleep -Seconds 2
    }
    if (!$cron) { throw 'pg_cron no está configurado en la base de prueba.' }
    & docker cp $Dump ($nombre + ':/tmp/respaldo.dump') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Error copiando el dump.' }
    & docker cp $InventorySql ($nombre + ':/tmp/inventario.sql') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Error copiando el inventario.' }
    Write-Host '=== RESTAURANDO BASE COMPLETA ==='
    $salida = & docker exec -e "PGPASSWORD=$clave" $nombre pg_restore -w -h 127.0.0.1 -U supabase_admin -d ulit_verificacion --no-owner --exit-on-error --single-transaction /tmp/respaldo.dump 2>&1
    $codigo = $LASTEXITCODE
    $salida | Out-File -LiteralPath $log -Encoding utf8
    if ($codigo -ne 0) {
        $salida | Select-Object -Last 8 | ForEach-Object { Write-Host $_ }
        throw 'La restauración ha fallado; no se considera verificada.'
    }
    Write-Host 'RESTAURACIÓN SQL SIN ERRORES'
    $restaurado = & docker exec -e "PGPASSWORD=$clave" $nombre psql -w -h 127.0.0.1 -U supabase_admin -d ulit_verificacion -X -At -v ON_ERROR_STOP=1 -f /tmp/inventario.sql 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Fallo obteniendo inventario restaurado.' }
    $a = @(Get-Content -LiteralPath "$Dump.inventario" | Where-Object { $_ -match '^(objeto|datos)\|' })
    $b = @($restaurado | Where-Object { $_ -match '^(objeto|datos)\|' })
    $b | Set-Content -LiteralPath $inventarioRestaurado -Encoding utf8
    $datosA = @($a | Where-Object { $_ -like 'datos|*' } | Sort-Object -CaseSensitive)
    $datosB = @($b | Where-Object { $_ -like 'datos|*' } | Sort-Object -CaseSensitive)
    $difDatos = @(Compare-Object -CaseSensitive $datosA $datosB)
    function Normalizar([string]$l) {
        if ($l -match '^objeto\|(fn|rel)\|') { return ($l -replace '\|[^|]*$', '') }
        if ($l -match '^objeto\|pol\|') { return ($l -creplace '(?<![\w.])(uid|role|jwt)\s*\(', 'auth.$1(') }
        return $l
    }
    $objetosA = @($a | Where-Object { $_ -like 'objeto|*' } | ForEach-Object { Normalizar $_ } | Sort-Object -CaseSensitive)
    $objetosB = @($b | Where-Object { $_ -like 'objeto|*' } | ForEach-Object { Normalizar $_ } | Sort-Object -CaseSensitive)
    $difLogicas = @(Compare-Object -CaseSensitive $objetosA $objetosB)
    $rls = & docker exec $nombre pg_restore --schema-only --file=- /tmp/respaldo.dump 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'No se ha podido inspeccionar RLS en el volcado.' }
    $habilitado = @($rls | Where-Object { $_ -match '^\s*ALTER TABLE (?:ONLY )?"?(?:public|ulit_go|ulit_censo)"?\.' -and $_ -match '\bENABLE ROW LEVEL SECURITY;' }).Count
    $forzado = @($rls | Where-Object { $_ -match '^\s*ALTER TABLE (?:ONLY )?"?(?:public|ulit_go|ulit_censo)"?\.' -and $_ -match '\bFORCE ROW LEVEL SECURITY;' }).Count
    Write-Host '=== DIAGNÓSTICO SIN DATOS PERSONALES ==='
    Write-Host "Tablas origen: $($datosA.Count); restauradas: $($datosB.Count); diferencias de datos: $($difDatos.Count)"
    Write-Host "Objetos origen: $($objetosA.Count); restaurados: $($objetosB.Count); diferencias lógicas normalizadas: $($difLogicas.Count)"
    Write-Host "Instrucciones RLS: ENABLE $habilitado; FORCE $forzado"
    if ($datosA.Count -eq 0 -or $objetosA.Count -eq 0 -or $difDatos.Count -ne 0 -or $difLogicas.Count -ne 0) {
        throw 'El inventario no coincide. NO se acredita recuperabilidad.'
    }
    Write-Host 'OK: DATOS Y DEFINICIONES LÓGICAS COINCIDEN EN POSTGRESQL LOCAL.'
    Write-Host 'ACL/roles globales y funcionamiento de Auth/Storage/Edge Functions siguen fuera de este alcance.'
}
finally {
    if ($iniciado) { & docker rm -f $nombre *> $null }
    Remove-Item -LiteralPath $rolesArchivo -Force -ErrorAction SilentlyContinue
    Remove-Variable clave -ErrorAction SilentlyContinue
    Write-Host 'CONTENEDOR TEMPORAL ELIMINADO'
}
