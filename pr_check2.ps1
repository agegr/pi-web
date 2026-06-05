[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$url = "https://api.github.com/repos/agegr/pi-web/pulls/39"
try {
  $r = Invoke-RestMethod $url -TimeoutSec 10
  Write-Host "State: $($r.state)"
  Write-Host "Title: $($r.title)"
  Write-Host "Mergeable: $($r.mergeable)"
  Write-Host "Comments: $($r.comments)"
} catch {
  Write-Host "Error: $_"
}
