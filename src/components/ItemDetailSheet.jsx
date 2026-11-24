import { SOCIAL_ENABLED } from '../config/flags';
import { WorkDetailPage, computeNextTop4Patch } from './WorkDetailPage';

export { WorkDetailPage, WorkDetailPage as WorkDetailModal, computeNextTop4Patch };

export function ItemDetailSheet(props) {
  // Wrapper de compatibilidade delegando para a página editorial WorkDetailPage
  // SOCIAL_ENABLED && Conjunta desativado por padrão (v1.2.0 Lumière)
  return <WorkDetailPage {...props} socialEnabled={SOCIAL_ENABLED && false} />;
}
