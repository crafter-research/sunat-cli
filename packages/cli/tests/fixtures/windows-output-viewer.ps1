param(
	[Parameter(Mandatory = $true)][string]$Title,
	[Parameter(Mandatory = $true)][string]$Path
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.Width = 1000
$form.Height = 700
$form.StartPosition = "CenterScreen"

$text = New-Object System.Windows.Forms.TextBox
$text.Multiline = $true
$text.ReadOnly = $true
$text.ScrollBars = "Vertical"
$text.WordWrap = $true
$text.Dock = "Fill"
$text.Font = New-Object System.Drawing.Font("Consolas", 14)
$text.Text = [System.IO.File]::ReadAllText((Resolve-Path $Path))

$form.Controls.Add($text)
[void]$form.ShowDialog()
