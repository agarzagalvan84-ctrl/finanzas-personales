// Configuración de conexión al backend (Google Apps Script)
// 1. https://script.google.com/macros/s/AKfycbw6UsdSwxnWp-Aml2MJxZU9cq2Sq_h6ly57DzlvTMwwh2OprSw9M21CkIvwdTcFZLwl/exec
// 2. AGG84DGL85
//
// Nota de seguridad: si este repo/GitHub Pages es público, cualquiera que
// vea el código fuente puede leer este token. Es el mismo modelo del Board
// de ALLTANSA (seguridad por token fijo, no por repo privado). Acéptalo con
// esa conciencia o usa un repo privado + GitHub Pages vía Actions si prefieres
// más resguardo.

const API_URL = 'https://script.google.com/macros/s/AKfycbw6UsdSwxnWp-Aml2MJxZU9cq2Sq_h6ly57DzlvTMwwh2OprSw9M21CkIvwdTcFZLwl/exec
';
const API_TOKEN = 'AGG84DGL85';

// Opcional: liga directa a tu Google Sheet, para el botón "Abrir en Sheets"
// Formato: https://docs.google.com/spreadsheets/d/TU_SHEET_ID/edit
const SHEET_URL = '';
