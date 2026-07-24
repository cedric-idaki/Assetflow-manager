# Quick end-to-end test for the ingest-assets endpoint — simulates a website push.
#
# 1) Deploy first (migrations + function), then in Ararat open
#    Assets & Clients -> Website Sync -> Generate key, and copy the key.
# 2) Run this with your project URL + that key:
#
#    ./test-ingest.ps1 -Url "https://<project-ref>.supabase.co/functions/v1/ingest-assets" -Key "afk_..."
#
# Run it once  -> summary shows created: 1
# Run it again -> summary shows updated: 1  (proves no duplicates)
# Add -Sold    -> marks the same item sold.

param(
  [Parameter(Mandatory)] [string]$Url,
  [Parameter(Mandatory)] [string]$Key,
  [string]$Ref = "test-001",
  [switch]$Sold
)

$item = @{
  external_ref = $Ref
  name         = "2022 Toyota Land Cruiser (test)"
  type         = "vehicle"
  price        = 8500000
  location     = "Nairobi"
  images       = @("https://picsum.photos/seed/car/600/400")
  attributes   = @{ make = "Toyota"; model = "Land Cruiser"; year = 2022; mileage = 45000; fuel = "Diesel" }
}
if ($Sold) { $item.sold = $true }
$body = ($item | ConvertTo-Json -Depth 6)

Write-Host "POST $Url  (external_ref=$Ref, sold=$($Sold.IsPresent))" -ForegroundColor Cyan
try {
  $res = Invoke-RestMethod -Method Post -Uri $Url -Headers @{ "x-api-key" = $Key } `
    -ContentType "application/json" -Body $body
  $res | ConvertTo-Json -Depth 6
} catch {
  Write-Host "Request FAILED:" -ForegroundColor Red
  if ($_.Exception.Response) { Write-Host ("HTTP " + [int]$_.Exception.Response.StatusCode) -ForegroundColor Red }
  if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message -ForegroundColor Yellow }
}
