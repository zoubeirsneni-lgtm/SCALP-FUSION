import mt5ServerPy from '../../python_local/mt5_server.py?raw';
import scalpFusionEnginePy from '../../python_local/scalp_fusion_engine.py?raw';
import requirementsTxt from '../../python_local/requirements.txt?raw';
import installAndRunBat from '../../python_local/install_and_run.bat?raw';
import readmeLocalMd from '../../python_local/README_LOCAL_MT5.md?raw';

export interface PackFile {
  name: string;
  description: string;
  content: string;
}

export const PYTHON_PACK_FILES: PackFile[] = [
  {
    name: 'mt5_server.py',
    description: 'Serveur FastAPI local connecté au terminal MetaTrader 5 Exness (port 8765)',
    content: mt5ServerPy,
  },
  {
    name: 'scalp_fusion_engine.py',
    description: 'Moteur Python exact SCALP FUSION v1.1 + agrégateur de ticks 30s',
    content: scalpFusionEnginePy,
  },
  {
    name: 'requirements.txt',
    description: 'Dépendances Python (MetaTrader5, FastAPI, Uvicorn, Pydantic)',
    content: requirementsTxt,
  },
  {
    name: 'install_and_run.bat',
    description: 'Script Windows 1-clic pour créer le .venv, installer et démarrer le pont MT5',
    content: installAndRunBat,
  },
  {
    name: 'README_LOCAL_MT5.md',
    description: 'Guide complet d’installation et d’utilisation locale avec Exness MT5',
    content: readmeLocalMd,
  },
];
