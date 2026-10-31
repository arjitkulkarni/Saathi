import { getDeviceDetail } from '@saathi/db';
import { can } from '@saathi/domain';
import { StateScreen } from '@/components/shared/states';
import { load } from '@/server/actor';
import { pageContext } from '@/server/page';
import { DeviceDetailView } from './device-detail';

export default async function DevicePage(props: PageProps<'/app/devices/[id]'>) {
  const { id } = await props.params;
  const { ctx, i18n } = await pageContext(`/app/devices/${id}`);
  const res = /^[0-9a-f-]{36}$/.test(id) ? await load(ctx, (db) => getDeviceDetail(db, ctx.actor, id)) : ({ ok: false, code: 'NOT_FOUND', message: '' } as const);
  if (!res.ok) return <StateScreen code={res.code} t={i18n.t} backHref="/app/devices" />;
  return <DeviceDetailView initial={res.data} canPreview={can(ctx.actor.role, 'people.preview')} canRetire={can(ctx.actor.role, 'devices.retire')} />;
}
