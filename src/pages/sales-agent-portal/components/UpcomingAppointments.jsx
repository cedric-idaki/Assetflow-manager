import React from 'react';
import Icon from '../../../components/AppIcon';

const TYPE_STYLES = {
  site_visit: 'bg-primary/10 text-primary',
  office_meeting: 'bg-blue-500/10 text-blue-600',
  phone_call: 'bg-emerald-500/10 text-emerald-600',
  follow_up: 'bg-amber-500/10 text-amber-600',
};

const UpcomingAppointments = ({ followUps, loading }) => {
  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="h-5 bg-muted rounded w-44 mb-4 animate-pulse" />
        {[...Array(3)]?.map((_, i) => (
          <div key={i} className="flex gap-3 mb-3 animate-pulse">
            <div className="w-10 h-10 rounded-lg bg-muted flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 bg-muted rounded w-2/3" />
              <div className="h-3 bg-muted rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading font-semibold text-base text-foreground">Upcoming Appointments</h3>
        <Icon name="Calendar" size={18} color="var(--color-primary)" />
      </div>
      <div className="space-y-3 max-h-[380px] overflow-y-auto scrollbar-custom pr-1">
        {followUps?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Icon name="CalendarX" size={28} color="var(--color-muted-foreground)" />
            <p className="text-sm text-muted-foreground mt-2">No upcoming appointments</p>
          </div>
        ) : (
          followUps?.map((appt) => {
            const dt = new Date(appt?.scheduled_at);
            const typeStyle = TYPE_STYLES?.[appt?.appointment_type] || 'bg-muted text-muted-foreground';
            return (
              <div key={appt?.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                <div className="flex-shrink-0 w-10 text-center">
                  <p className="text-xs font-bold text-foreground">{dt?.toLocaleDateString('en-US', { month: 'short' })}</p>
                  <p className="text-lg font-bold text-primary leading-none">{dt?.getDate()}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{appt?.lead_name || 'Unknown Lead'}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Icon name="Clock" size={11} color="var(--color-muted-foreground)" />
                    <span className="text-xs text-muted-foreground">
                      {dt?.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {appt?.location && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Icon name="MapPin" size={11} color="var(--color-muted-foreground)" />
                      <span className="text-xs text-muted-foreground truncate">{appt?.location}</span>
                    </div>
                  )}
                </div>
                <span className={`flex-shrink-0 px-2 py-0.5 rounded text-xs font-medium ${typeStyle}`}>
                  {(appt?.appointment_type || 'follow_up')?.replace('_', ' ')}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default UpcomingAppointments;