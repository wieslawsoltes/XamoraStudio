import {parseXaml} from './xaml.js';
export const mainXaml=`<UserControl xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
             xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
             x:Name="WorkspaceView" Width="1100" Height="760" Background="#FFFFFF">
    <UserControl.Resources>
        <SolidColorBrush x:Key="AccentBrush" Color="#7953E8" />
        <SolidColorBrush x:Key="InkBrush" Color="#252432" />
        <SolidColorBrush x:Key="MutedBrush" Color="#8A879A" />
        <SolidColorBrush x:Key="SurfaceBrush" Color="#F7F6FA" />
    </UserControl.Resources>
    <Grid x:Name="WorkspaceLayout">
        <Grid.ColumnDefinitions><ColumnDefinition Width="205" /><ColumnDefinition Width="*" /></Grid.ColumnDefinitions>
        <Grid.RowDefinitions><RowDefinition Height="74" /><RowDefinition Height="*" /></Grid.RowDefinitions>
        <Border x:Name="Sidebar" Grid.RowSpan="2" Background="#FAF9FC" BorderBrush="#ECEAF1" BorderThickness="0,0,1,0" Padding="22,28">
            <DockPanel>
                <StackPanel DockPanel.Dock="Top">
                    <TextBlock Text="◈  lumio" FontSize="26" FontWeight="Bold" Foreground="#252432" Margin="0,0,0,40" />
                    <TextBlock Text="WORKSPACE" FontSize="10" FontWeight="SemiBold" Foreground="#A7A3B3" Margin="10,0,0,14" />
                    <Border Background="#EDE6FE" CornerRadius="7" Padding="13,12" Margin="0,0,0,7"><TextBlock Text="▦   Overview" Foreground="#7953E8" FontWeight="SemiBold" FontSize="13" /></Border>
                    <TextBlock Text="▱   Projects" Foreground="#7D788F" FontSize="13" Margin="13,12" />
                    <TextBlock Text="◷   My tasks" Foreground="#7D788F" FontSize="13" Margin="13,12" />
                    <TextBlock Text="▤   Inbox" Foreground="#7D788F" FontSize="13" Margin="13,12" />
                    <TextBlock Text="TEAM" FontSize="10" FontWeight="SemiBold" Foreground="#A7A3B3" Margin="10,35,0,12" />
                    <TextBlock Text="♧   Members" Foreground="#7D788F" FontSize="13" Margin="13,12" />
                    <TextBlock Text="⚙   Settings" Foreground="#7D788F" FontSize="13" Margin="13,12" />
                </StackPanel>
                <Border DockPanel.Dock="Bottom" Background="#F0EDF6" CornerRadius="10" Padding="14" Margin="0,26,0,0">
                    <StackPanel><TextBlock Text="A little more space." FontSize="12" FontWeight="SemiBold" Margin="0,0,0,6" /><TextBlock Text="Bring your next big idea to life." TextWrapping="Wrap" FontSize="11" Foreground="#91899E" Margin="0,0,0,12" /><Button Content="Explore Pro  ↗" Background="#FFFFFF" Foreground="#615771" Height="32" FontSize="11" /></StackPanel>
                </Border>
                <Grid />
            </DockPanel>
        </Border>
        <Border Grid.Column="1" BorderBrush="#ECEAF1" BorderThickness="0,0,0,1" Padding="30,0">
            <DockPanel><TextBlock DockPanel.Dock="Left" Text="Workspace  /  Overview" Foreground="#8E899D" FontSize="12" VerticalAlignment="Center" /><Border DockPanel.Dock="Right" Background="#EDE6FE" CornerRadius="18" Width="34" Height="34" VerticalAlignment="Center"><TextBlock Text="AM" FontSize="10" FontWeight="Bold" Foreground="#7953E8" HorizontalAlignment="Center" VerticalAlignment="Center" /></Border><TextBlock Text="⌕     Search anything..." Foreground="#AAA5B6" FontSize="11" HorizontalAlignment="Right" VerticalAlignment="Center" Margin="0,0,25,0" /></DockPanel>
        </Border>
        <Grid x:Name="MainContent" Grid.Row="1" Grid.Column="1" Margin="32,30">
            <Grid.RowDefinitions><RowDefinition Height="88" /><RowDefinition Height="145" /><RowDefinition Height="*" /></Grid.RowDefinitions>
            <DockPanel>
                <Button DockPanel.Dock="Right" x:Name="NewProjectButton" Content="＋  New project" Background="{StaticResource AccentBrush}" Foreground="#FFFFFF" FontSize="12" Height="38" Width="130" VerticalAlignment="Top" Margin="0,6,0,0" />
                <StackPanel><TextBlock Text="Make room for great work." FontSize="27" FontWeight="SemiBold" Foreground="#252432" /><TextBlock Text="Welcome back, Alex. Here’s what’s happening today." FontSize="12" Foreground="#918B9F" Margin="0,9,0,0" /></StackPanel>
            </DockPanel>
            <Grid Grid.Row="1" Margin="0,0,0,26">
                <Grid.ColumnDefinitions><ColumnDefinition Width="*" /><ColumnDefinition Width="*" /><ColumnDefinition Width="*" /></Grid.ColumnDefinitions>
                <Border x:Name="ProjectsMetric" BorderBrush="#EAE7F0" BorderThickness="1" CornerRadius="10" Padding="19,17" Margin="0,0,14,0"><StackPanel><TextBlock Text="Active projects                       ▱" Foreground="#918B9F" FontSize="11" /><TextBlock Text="12" FontSize="30" FontWeight="SemiBold" Foreground="#292533" Margin="0,8,0,3" /><TextBlock Text="↗  2 new this month" Foreground="#56A88A" FontSize="10" /></StackPanel></Border>
                <Border x:Name="TasksMetric" Grid.Column="1" BorderBrush="#EAE7F0" BorderThickness="1" CornerRadius="10" Padding="19,17" Margin="0,0,14,0"><StackPanel><TextBlock Text="Tasks completed                      ✓" Foreground="#918B9F" FontSize="11" /><TextBlock Text="84" FontSize="30" FontWeight="SemiBold" Foreground="#292533" Margin="0,8,0,3" /><TextBlock Text="↗  18% from last month" Foreground="#56A88A" FontSize="10" /></StackPanel></Border>
                <Border x:Name="TeamMetric" Grid.Column="2" Background="#F5F1FF" BorderBrush="#E8E0FC" BorderThickness="1" CornerRadius="10" Padding="19,17"><StackPanel><TextBlock Text="Team productivity                    ◈" Foreground="#918B9F" FontSize="11" /><TextBlock Text="92.4%" FontSize="30" FontWeight="SemiBold" Foreground="#7953E8" Margin="0,8,0,3" /><TextBlock Text="A very good week for your team" Foreground="#A196B9" FontSize="10" /></StackPanel></Border>
            </Grid>
            <Grid Grid.Row="2">
                <Grid.ColumnDefinitions><ColumnDefinition Width="1.55*" /><ColumnDefinition Width="*" /></Grid.ColumnDefinitions>
                <Border x:Name="ProjectsCard" BorderBrush="#EAE7F0" BorderThickness="1" CornerRadius="12" Padding="22" Margin="0,0,20,0">
                    <StackPanel><DockPanel Margin="0,0,0,24"><TextBlock DockPanel.Dock="Right" Text="View all  →" Foreground="#9B93AE" FontSize="10" VerticalAlignment="Center" /><TextBlock Text="Your projects" FontSize="15" FontWeight="SemiBold" /></DockPanel>
                        <Border Background="#F8F7FB" CornerRadius="9" Padding="15" Margin="0,0,0,12"><StackPanel><TextBlock Text="◈    Brand refresh" FontSize="13" FontWeight="SemiBold" /><TextBlock Text="       Design system · 16 tasks" FontSize="10" Foreground="#9A92A9" Margin="0,5,0,13" /><ProgressBar Value="72" Height="4" Foreground="#A892EB" /><TextBlock Text="72% complete                           Due Oct 24" Foreground="#9A92A9" FontSize="9" Margin="0,9,0,0" /></StackPanel></Border>
                        <Border Background="#F8F7FB" CornerRadius="9" Padding="15" Margin="0,0,0,12"><StackPanel><TextBlock Text="▦    Website experience" FontSize="13" FontWeight="SemiBold" /><TextBlock Text="       Product design · 24 tasks" FontSize="10" Foreground="#9A92A9" Margin="0,5,0,13" /><ProgressBar Value="48" Height="4" Foreground="#86BBAB" /><TextBlock Text="48% complete                           Due Nov 02" Foreground="#9A92A9" FontSize="9" Margin="0,9,0,0" /></StackPanel></Border>
                        <Button Content="＋  Create a project" Background="#FFFFFF" Foreground="#A198B2" BorderBrush="#EAE7F0" BorderThickness="1" Height="35" FontSize="10" />
                    </StackPanel>
                </Border>
                <Border x:Name="ActivityCard" Grid.Column="1" BorderBrush="#EAE7F0" BorderThickness="1" CornerRadius="12" Padding="22">
                    <StackPanel><TextBlock Text="Activity" FontSize="15" FontWeight="SemiBold" Margin="0,0,0,24" /><TextBlock Text="●   Mia added 3 new explorations" Foreground="#777085" FontSize="11" /><TextBlock Text="      Brand refresh · 12 minutes ago" Foreground="#A7A0B4" FontSize="9" Margin="0,7,0,25" /><TextBlock Text="●   Noah completed onboarding" Foreground="#777085" FontSize="11" /><TextBlock Text="      Website experience · 48 min ago" Foreground="#A7A0B4" FontSize="9" Margin="0,7,0,25" /><TextBlock Text="●   You shared the design system" Foreground="#777085" FontSize="11" /><TextBlock Text="      Brand refresh · 2 hours ago" Foreground="#A7A0B4" FontSize="9" Margin="0,7,0,25" /><Border Background="#F6F3FC" CornerRadius="8" Padding="14" Margin="0,10,0,0"><StackPanel><TextBlock Text="Everything is in a good place." Foreground="#8C7AAA" FontSize="10" FontWeight="SemiBold" /><TextBlock Text="Keep making things that matter." Foreground="#A99DBC" FontSize="9" Margin="0,6,0,0" /></StackPanel></Border></StackPanel>
                </Border>
            </Grid>
        </Grid>
    </Grid>
</UserControl>`;
export const templateXaml=`<ControlTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" x:Key="PrimaryButtonTemplate" TargetType="Button">
    <Border x:Name="PART_Border" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="1" CornerRadius="8" Padding="20,12">
        <ContentPresenter x:Name="PART_Content" Content="{TemplateBinding Content}" HorizontalAlignment="Center" VerticalAlignment="Center" />
    </Border>
</ControlTemplate>`;
export const resourceXaml=`<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
    <SolidColorBrush x:Key="AccentBrush" Color="#7953E8" />
    <SolidColorBrush x:Key="SurfaceBrush" Color="#F7F6FA" />
    <SolidColorBrush x:Key="InkBrush" Color="#252432" />
    <SolidColorBrush x:Key="MutedBrush" Color="#8A879A" />
    <Style x:Key="PrimaryButton" TargetType="Button">
        <Setter Property="Background" Value="{StaticResource AccentBrush}" />
        <Setter Property="Foreground" Value="White" />
        <Setter Property="Padding" Value="18,10" />
    </Style>
</ResourceDictionary>`;
export function samples(){const docs=[parseXaml(mainXaml),parseXaml(templateXaml,{name:'PrimaryButton.xaml'}),parseXaml(resourceXaml,{name:'AppResources.xaml'})];docs[1].design={width:380,height:140};docs[1].metadata.templateSample={Content:'Create a project',Background:'#7953E8',Foreground:'#FFFFFF',BorderBrush:'#7953E8'};docs[0].annotations=[{id:'a1',nodeId:null,x:1020,y:345,text:'Try a softer accent for the activity panel.',author:'Design note',resolved:false}];return docs;}
